import { createExchangeWebSocketClient, type Unsubscribe } from "@gammaswap/v2-exchange-sdk";
import { RUNTIME_CFG as CFG } from "./context.js";
import { RuntimeEventQueue } from "./events.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("orderbook");

export type OrderBookFeed = {
  close(): Promise<void>;
};

export async function startOrderBookFeed(queue: RuntimeEventQueue): Promise<OrderBookFeed> {
  const client = createExchangeWebSocketClient({
    websocketUrl: CFG.ORDERBOOK_WS_URL,
    reconnect: true,
    onError: (error) => logger.warn("orderbook websocket error:", error),
  });

  const unsubscribe: Unsubscribe = await client.subscribeOrderBook(CFG.ASSET_ID, {
    onUpdate: (update) => {
      queue.publish({ type: "market", update });
    },
    onResyncRequired: (assetId) => {
      logger.warn("orderbook websocket requires resync:", assetId);
      queue.publish({ type: "market-resync", reason: `SDK resync for ${assetId}` });
    },
    onError: (error) => logger.warn("orderbook subscription error:", error),
  });

  logger.info("orderbook subscribed", {
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
