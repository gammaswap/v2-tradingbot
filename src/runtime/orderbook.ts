import {
    createExchangeWebSocketClient,
    type Unsubscribe,
    type WebSocketTradeUpdate,
} from "@gammaswap/v2-exchange-sdk";
import type { Wallet } from "ethers";
import { CFG } from "../config/config.js";
import {
    apiGetBalance,
    apiGetBook,
    apiGetPending,
    apiGetPosition,
} from "../api/api.js";
import { getOrderKey } from "../utils/utils.js";
import { midPrice } from "./strategy.js";
import { STATE } from "./state.js";
import type { PendingOrder } from "../utils/types.js";
import { debug, log, warn } from "../utils/utils.js";

export type OrderBookFeed = {
    close(): Promise<void>;
};

export async function startOrderBookFeed(wallet: Wallet): Promise<OrderBookFeed> {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight: Promise<void> | null = null;
    let closed = false;
    let lastSeq: bigint | null = null;
    let lastTradeSeq: bigint | null = null;

    const refreshState = async () => {
        if (closed) return;
        if (refreshInFlight) return refreshInFlight;

        refreshInFlight = (async () => {
            const [book, pending, balance, position] = await Promise.all([
                apiGetBook(Number(STATE.epoch)),
                apiGetPending(wallet.address, Number(STATE.epoch)),
                apiGetBalance(),
                apiGetPosition(Number(STATE.epoch)),
            ]);

            STATE.book = book;
            STATE.lastMid = midPrice(book);
            applyPending(pending);
            STATE.baseBal = Number(balance.balance - balance.pending);
            STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1);

            debug("orderbook state reconciled", {
                epoch: STATE.epoch.toString(),
                bids: book.bids.length,
                asks: book.asks.length,
                pending: STATE.pending.size,
                balance: STATE.baseBal,
                inventory: STATE.invBase,
            });
        })().catch((error) => {
            warn("orderbook state reconciliation failed:", error?.message ?? error);
        }).finally(() => {
            refreshInFlight = null;
        });

        return refreshInFlight;
    };

    const scheduleRefresh = (delayMs = 100) => {
        if (closed || refreshTimer) return;
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            void refreshState();
        }, delayMs);
    };

    const handleTrade = (update: WebSocketTradeUpdate) => {
        const trade = update.data;
        const order = STATE.pending.get(trade.orderId);

        if (lastTradeSeq != null && update.seqId <= lastTradeSeq) return;
        lastTradeSeq = update.seqId;

        if (order) {
            const fill = Number(trade.fill);
            const fillPrice = Number(trade.fillPrice);
            if (fill > 0) {
                STATE.invBase += order.side === "buy" ? fill : -fill;
                STATE.lastTradeTime = Date.now();
                log("order execution", {
                    orderId: trade.orderId,
                    side: order.side,
                    fill,
                    fillPrice,
                    seqId: update.seqId.toString(),
                });
            }
        } else {
            debug("trade for untracked order", {
                orderId: trade.orderId,
                fill: trade.fill.toString(),
                seqId: update.seqId.toString(),
            });
        }

        // The event gives a fast execution signal; REST remains authoritative.
        scheduleRefresh();
    };

    const client = createExchangeWebSocketClient({
        websocketUrl: CFG.ORDERBOOK_WS_URL,
        reconnect: true,
        onError: (error) => warn("orderbook websocket error:", error),
    });

    let unsubscribe: Unsubscribe | null = null;
    unsubscribe = await client.subscribeOrderBook(CFG.ASSET_ID, {
        onUpdate: (update) => {
            if (lastSeq != null && update.seqId > lastSeq + 1n) {
                warn("orderbook sequence gap; scheduling full resync", {
                    previous: lastSeq.toString(),
                    received: update.seqId.toString(),
                });
                scheduleRefresh(0);
            }
            lastSeq = update.seqId;
            scheduleRefresh();
        },
        onTrade: handleTrade,
        onOrder: () => scheduleRefresh(),
        onCancel: () => scheduleRefresh(),
        onResolution: () => {
            lastSeq = null;
            lastTradeSeq = null;
            scheduleRefresh(0);
        },
        onResyncRequired: (assetId) => {
            warn("orderbook websocket requires resync:", assetId);
            lastSeq = null;
            lastTradeSeq = null;
            scheduleRefresh(0);
        },
        onError: (error) => warn("orderbook subscription error:", error),
    });

    await refreshState();
    log("orderbook subscribed", {
        websocketUrl: CFG.ORDERBOOK_WS_URL,
        assetId: CFG.ASSET_ID,
    });

    return {
        close: async () => {
            closed = true;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = null;
            if (unsubscribe) {
                try {
                    await unsubscribe();
                } catch (error: any) {
                    warn("orderbook unsubscribe error:", error?.message ?? error);
                }
            }
            client.close();
        },
    };
}

function applyPending(response: Awaited<ReturnType<typeof apiGetPending>>) {
    const next = new Map<string, PendingOrder>();

    for (const [orders, side] of [
        [response.buys ?? [], "buy"],
        [response.sells ?? [], "sell"],
    ] as const) {
        for (const value of orders) {
            const order = {
                id: String(value.id),
                side,
                price: Number(value.price),
                size: Number(value.size),
                time: Number(value.time),
                account: value.account,
                epoch: BigInt(response.epoch),
            } as PendingOrder;
            next.set(order.id, order);
        }
    }

    STATE.pendingBuys.clear();
    STATE.pendingSells.clear();
    for (const order of next.values()) {
        const key = getOrderKey(order);
        if (order.side === "buy") STATE.pendingBuys.set(key, order);
        else STATE.pendingSells.set(key, order);
    }
    STATE.pending = next;
}
