import {
    createOracleWebSocketClient,
    type Unsubscribe,
} from "@gammaswap/v2-exchange-sdk";
import { RUNTIME_CFG as CFG, RUNTIME_STATE as STATE } from "./context.js";
import { debug, log, warn } from "../utils/utils.js";
import { RuntimeEventQueue } from "./events.js";

export type OracleFeed = {
    close(): Promise<void>;
    waitForFirstPrice(timeoutMs?: number): Promise<boolean>;
};

export async function startOracleFeed(queue: RuntimeEventQueue): Promise<OracleFeed> {
    if (!CFG.USE_ORACLE_FAIR_VALUE) {
        return {
            close: async () => {},
            waitForFirstPrice: async () => true,
        };
    }

    const client = createOracleWebSocketClient({
        websocketUrl: CFG.ORACLE_FEED_WS_URL,
        stalePriceTimeoutMs: CFG.ORACLE_STALE_PRICE_TIMEOUT_MS,
        onError: (error) => warn("oracle websocket error:", error),
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

    unsubscribe = await client.subscribePrice(symbolId, {
        onPrice: (update) => {
            notifyFirstPrice();
            debug("oracle price update:", {
                symbolId: update.symbolId.toString(),
                price: update.price.toString(),
                ts: update.ts.toString(),
            });
            queue.publish({ type: "oracle-price", update });
        },
        onStale: (symbolId) => {
            warn("oracle stream stale:", symbolId);
            queue.publish({ type: "oracle-stale", symbolId });
        },
        onError: (error) => warn("oracle subscription error:", error),
    });

    log("oracle subscribed:", {
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
                } catch (e: any) {
                    warn("oracle unsubscribe error:", e?.message ?? e);
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
