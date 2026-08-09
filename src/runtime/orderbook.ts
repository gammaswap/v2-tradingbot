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
    const client = createExchangeWebSocketClient({
        websocketUrl: CFG.ORDERBOOK_WS_URL,
        reconnect: true,
        onError: (error) => warn("orderbook websocket error:", error),
    });

    const unsubscribe: Unsubscribe = await client.subscribeOrderBook(CFG.ASSET_ID, {
        onUpdate: (update) => {
            queue.publish({ type: "market", update });
        },
        onResyncRequired: (assetId) => {
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
