import {
    createExchangeWebSocketClient,
    type Unsubscribe,
} from "@gammaswap/v2-exchange-sdk";
import { CFG } from "../config/config.js";
import { RuntimeEventQueue } from "./events.js";
import { log, warn } from "../utils/utils.js";

export type OrderBookFeed = {
    close(): Promise<void>;
};

export async function startOrderBookFeed(queue: RuntimeEventQueue): Promise<OrderBookFeed> {
    let lastSeq: bigint | null = null;
    const client = createExchangeWebSocketClient({
        websocketUrl: CFG.ORDERBOOK_WS_URL,
        reconnect: true,
        onError: (error) => warn("orderbook websocket error:", error),
    });

    const unsubscribe: Unsubscribe = await client.subscribeOrderBook(CFG.ASSET_ID, {
        onUpdate: (update) => {
            if (lastSeq != null && update.seqId > lastSeq + 1n) {
                warn("orderbook sequence gap; requesting full resync", {
                    previous: lastSeq.toString(),
                    received: update.seqId.toString(),
                });
                queue.publish({ type: "market-resync", reason: "websocket sequence gap" });
            }

            lastSeq = update.seqId;
            queue.publish({ type: "market", update });
        },
        onResyncRequired: (assetId) => {
            lastSeq = null;
            warn("orderbook websocket requires resync:", assetId);
            queue.publish({ type: "market-resync", reason: `SDK resync for ${assetId}` });
        },
        onError: (error) => warn("orderbook subscription error:", error),
    });

    log("orderbook subscribed", {
        websocketUrl: CFG.ORDERBOOK_WS_URL,
        assetId: CFG.ASSET_ID,
    });

    return {
        close: async () => {
            await unsubscribe();
            client.close();
        },
    };
}
