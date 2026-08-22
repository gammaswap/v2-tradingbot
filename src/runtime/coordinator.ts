import type { WebSocketTradeUpdate } from "@gammaswap/v2-exchange-sdk";
import type { Wallet } from "ethers";
import { CFG } from "../config/config.js";
import { apiGetBook } from "../api/api.js";
import { markFairValueStale, updateFairValueFromOracle } from "./fairValue.js";
import { refreshPrivateState, runAggression, runAssetEpochCheck, runQuoteMaintenance } from "./loops.js";
import type { RuntimeEvent, RuntimeEventQueue } from "./events.js";
import { STATE } from "./state.js";
import { midPrice } from "./strategy.js";
import {
    applyMarketUpdate,
    buildBookSnapshot,
    createLocalOrderBookState,
    installBookSnapshot,
    type LocalOrderBookState,
} from "./orderbookReducer.js";
import { jitter, debug, log, nowMs, warn } from "../utils/utils.js";
import { protocolValueToSafeNumber } from "../utils/protocolMath.js";

const EPOCH_CHECK_MS = 1_000;

export type CoordinatorStepContext = {
    wallet: Wallet;
    queue: RuntimeEventQueue;
    localBook: LocalOrderBookState;
    nextEpochCheck: number;
    nextQuote: number;
    nextAggression: number;
    bookReady: boolean;
    assetReady: boolean;
};

export async function runRuntimeCoordinator(
    wallet: Wallet,
    queue: RuntimeEventQueue,
): Promise<void> {
    const localBook = createLocalOrderBookState(BigInt(CFG.ASSET_ID));
    const initialBookReady = await resyncBook(localBook);
    if (!initialBookReady) {
        throw new Error("unable to initialize the local orderbook");
    }
    await refreshPrivateState(wallet);

    const context: CoordinatorStepContext = {
        wallet,
        queue,
        localBook,
        nextEpochCheck: nowMs(),
        nextQuote: nowMs(),
        nextAggression: nowMs() + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS),
        bookReady: true,
        assetReady: true,
    };

    while (true) {
        await runCoordinatorStep(context);
    }
}

export async function runCoordinatorStep(context: CoordinatorStepContext): Promise<void> {
        const { queue, localBook, wallet } = context;
        const nextAction = Math.min(context.nextEpochCheck, context.nextQuote, context.nextAggression);
        await queue.wait(Math.max(0, nextAction - nowMs()));

        const events = queue.drain();
        const actions = processEvents(localBook, events);
        let bookReady = context.bookReady && !localBook.needsResync;

        if (actions.needsResync) {
            bookReady = await resyncBook(localBook);
        } else if (actions.marketChanged) {
            publishLocalBook(localBook);
        }

        if (actions.needsResync || actions.ownTradeOccurred) {
            await refreshPrivateState(wallet);
        }

        const now = nowMs();
        if (now >= context.nextEpochCheck) {
            const epochBefore = STATE.epoch;
            try {
                const epochStatus = await runAssetEpochCheck(wallet);
                context.assetReady = true;
                if (epochStatus.changed || STATE.epoch !== epochBefore) {
                    bookReady = await resyncBook(localBook);
                    await refreshPrivateState(wallet);
                }
            } catch (error: any) {
                context.assetReady = false;
                bookReady = false;
                warn("asset state refresh failed; trading is paused:", error?.message ?? error);
            }
            context.nextEpochCheck = now + EPOCH_CHECK_MS;
        }

        context.bookReady = bookReady && !localBook.needsResync;
        const tradingEnabled = context.bookReady && context.assetReady && STATE.asset != null && !STATE.asset.isResolved;

        if (tradingEnabled && (now >= context.nextQuote || actions.tradeOccurred || actions.needsResync)) {
            await runQuoteMaintenance(wallet);
            await refreshPrivateState(wallet);
            context.nextQuote = now + jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS);
        }

        if (tradingEnabled && now >= context.nextAggression) {
            await runAggression(wallet);
            await refreshPrivateState(wallet);
            context.nextAggression = now + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);
        }
}

async function resyncBook(state: LocalOrderBookState): Promise<boolean> {
    try {
        const snapshot = await apiGetBook(STATE.epoch);
        const ready = installBookSnapshot(state, snapshot);
        if (!ready) {
            warn("REST book snapshot did not cover buffered websocket events; another resync is required");
            return false;
        }

        publishLocalBook(state);
        log("local orderbook resynced", {
            seqId: state.seqId?.toString(),
            bids: STATE.book?.bids.length,
            asks: STATE.book?.asks.length,
        });
        return true;
    } catch (error: any) {
        warn("orderbook resync failed:", error?.message ?? error);
        return false;
    }
}

function publishLocalBook(state: LocalOrderBookState): void {
    STATE.book = buildBookSnapshot(state);
    STATE.lastMid = midPrice(STATE.book);
}

function processEvents(
    book: LocalOrderBookState,
    events: RuntimeEvent[],
): {
    needsResync: boolean;
    marketChanged: boolean;
    tradeOccurred: boolean;
    ownTradeOccurred: boolean;
} {
    let needsResync = false;
    let skipMarketEvents = false;
    let marketChanged = false;
    let tradeOccurred = false;
    let ownTradeOccurred = false;

    for (const event of events) {
        if (event.type === "market-resync") {
            needsResync = true;
            skipMarketEvents = true;
            warn("market resync requested:", event.reason);
            continue;
        }

        if (event.type === "oracle-price") {
            STATE.oracle.connected = true;
            const estimate = updateFairValueFromOracle(event.update.price, event.update.ts);
            debug("oracle state updated", {
                symbolId: event.update.symbolId.toString(),
                price: event.update.price.toString(),
                fairValue: estimate?.protocolPrice,
            });
            continue;
        }

        if (event.type === "oracle-stale") {
            STATE.oracle.connected = false;
            markFairValueStale();
            continue;
        }

        if (skipMarketEvents) continue;

        const result = applyMarketUpdate(book, event.update);
        if (result === "ignored" || result === "ignored-epoch" || result === "duplicate") {
            continue;
        }

        marketChanged = true;
        if (result === "buffered" || result === "invalid") {
            needsResync = true;
            skipMarketEvents = true;
            continue;
        }

        if (event.update.type === "trade") {
            tradeOccurred = true;
            ownTradeOccurred = applyTradeHint(event.update) || ownTradeOccurred;
        }
    }

    if (book.needsResync) needsResync = true;
    return { needsResync, marketChanged, tradeOccurred, ownTradeOccurred };
}

function applyTradeHint(update: WebSocketTradeUpdate): boolean {
    const order = STATE.pending.get(update.data.orderId);
    if (!order) return false;

    const fill = protocolValueToSafeNumber(BigInt(update.data.fill), "trade fill");
    if (fill <= 0) return false;

    STATE.invBase += order.side === "buy" ? fill : -fill;
    STATE.lastTradeTime = nowMs();
    log("order execution hint", {
        orderId: update.data.orderId,
        side: order.side,
        fill,
        fillPrice: Number(update.data.fillPrice),
        seqId: update.seqId.toString(),
    });
    return true;
}
