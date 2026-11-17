import { createOracleWebSocketClient, type Unsubscribe } from "@gammaswap/v2-exchange-sdk";
import {
  getBotContext,
  RUNTIME_CFG as CFG,
  RUNTIME_STATE as STATE,
  runWithBotContext,
} from "./context.js";
import { RuntimeEventQueue } from "./events.js";
import { Logger } from "../utils/logger.js";
import { errorMessage } from "../utils/utils.js";
import { markFairValueStale, updateFairValueFromOracle } from "./fairValue.js";
import { PROTOCOL_TICK_SIZE } from "../utils/protocolPrice.js";
import { hasFreshFairValue } from "./strategy.js";

const logger = new Logger("oracle");

export type OracleFeed = {
  close(): Promise<void>;
  waitForFirstPrice(timeoutMs?: number): Promise<boolean>;
};

export async function startOracleFeed(queue: RuntimeEventQueue): Promise<OracleFeed> {
  // TradingBot starts this function for every bot so feed cleanup and the
  // first-price lifecycle use one consistent interface. When fair value is
  // disabled, no websocket or subscription is created; a no-op feed is
  // returned instead.
  if (!CFG.USE_ORACLE_FAIR_VALUE) {
    return {
      close: async () => {},
      waitForFirstPrice: () => Promise.resolve(true),
    };
  }

  const client = createOracleWebSocketClient({
    websocketUrl: CFG.ORACLE_FEED_WS_URL,
    stalePriceTimeoutMs: CFG.ORACLE_STALE_PRICE_TIMEOUT_MS,
    onError: (error) => logger.warn("oracle websocket error:", error),
  });

  let unsubscribe: Unsubscribe | null = null;
  let firstPriceSeen = false;
  const firstPriceWaiters = new Set<(value: boolean) => void>();

  const notifyFirstPrice = () => {
    if (firstPriceSeen) return;
    firstPriceSeen = true;
    for (const resolve of firstPriceWaiters) resolve(true);
    firstPriceWaiters.clear();
  };

  const symbolId = STATE.oracle.symbolId;
  if (!symbolId) {
    throw new Error("cannot start oracle feed before the asset symbol ID is initialized");
  }

  const botContext = getBotContext();

  const minChange = CFG.ORACLE_NOTIFY_MIN_CHANGE_TICKS * PROTOCOL_TICK_SIZE;

  const notificationIntervalMs = CFG.ORACLE_NOTIFY_INTERVAL_MS;

  let lastNotification: {
    price: number | null;
    epoch: bigint;
    atMs: number;
  } | null = null;

  unsubscribe = await client.subscribePrice(symbolId, {
    onPrice: (update) => {
      runWithBotContext(botContext, () => {
        const wasFresh = hasFreshFairValue();

        STATE.oracle.connected = true;

        // Immediately updates oracle price, receipt time, and fair value.
        const estimate = updateFairValueFromOracle(update.price, update.ts);

        notifyFirstPrice();

        const currentPrice = estimate?.protocolPrice ?? null;
        const receivedAtMs = STATE.oracle.receivedAtMs;
        const previous = lastNotification;

        const availabilityChanged = wasFresh !== hasFreshFairValue();

        const significantChange =
          previous !== null &&
          previous.price !== null &&
          currentPrice !== null &&
          Math.abs(currentPrice - previous.price) >= minChange;

        const intervalElapsed =
          previous !== null && receivedAtMs - previous.atMs >= notificationIntervalMs;

        const shouldNotify =
          previous === null ||
          previous.epoch !== STATE.epoch ||
          availabilityChanged ||
          significantChange ||
          intervalElapsed;

        logger.debug("oracle price update:", {
          symbolId: update.symbolId.toString(),
          price: update.price.toString(),
          ts: update.ts.toString(),
        });

        if (!shouldNotify) return;

        // Only emitted notifications advance this baseline.
        lastNotification = {
          price: currentPrice,
          epoch: STATE.epoch,
          atMs: receivedAtMs,
        };

        queue.publish({ type: "oracle-state-changed" });
      });
    },
    onStale: (symbolId) => {
      runWithBotContext(botContext, () => {
        STATE.oracle.connected = false;
        markFairValueStale();

        // Force notification on the next price, even if unchanged.
        lastNotification = null;

        logger.warn("oracle stream stale:", symbolId);
        queue.publish({ type: "oracle-state-changed" });
      });
    },
    onError: (error) => logger.warn("oracle subscription error:", error),
  });

  logger.info("oracle subscribed:", {
    websocketUrl: CFG.ORACLE_FEED_WS_URL,
    symbolId,
  });

  return {
    close: async () => {
      for (const resolve of firstPriceWaiters) resolve(false);
      firstPriceWaiters.clear();
      if (unsubscribe) {
        try {
          await unsubscribe();
        } catch (e: unknown) {
          logger.warn("oracle unsubscribe error:", errorMessage(e));
        }
      }
      client.close();
    },
    waitForFirstPrice: async (timeoutMs = CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS) => {
      if (firstPriceSeen) return true;
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          firstPriceWaiters.delete(done);
          resolve(false);
        }, timeoutMs);

        const done = (value: boolean) => {
          clearTimeout(timer);
          resolve(value);
        };

        firstPriceWaiters.add(done);
      });
    },
  };
}
