import type { WebSocketTradeUpdate } from "@gammaswap/v2-exchange-sdk";
import type { Wallet } from "ethers";
import { CFG } from "../config/config.js";
import { markFairValueStale, updateFairValueFromOracle } from "./fairValue.js";
import { refreshTradingState, runAggression, runAssetEpochCheck, runQuoteMaintenance } from "./loops.js";
import { RuntimeEvent, RuntimeEventQueue } from "./events.js";
import { STATE } from "./state.js";
import { jitter, log, nowMs, warn } from "../utils/utils.js";

const EPOCH_CHECK_MS = 1_000;

export async function runRuntimeCoordinator(
    wallet: Wallet,
    queue: RuntimeEventQueue,
): Promise<void> {
    await refreshTradingState(wallet);

    let nextEpochCheck = nowMs();
    let nextQuote = nowMs();
    let nextAggression = nowMs() + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);

    while (true) {
        const nextAction = Math.min(nextEpochCheck, nextQuote, nextAggression);
        await queue.wait(Math.max(0, nextAction - nowMs()));

        const events = queue.drain();
        const actions = processEvents(events);

        if (actions.needsResync || actions.marketChanged) {
            await refreshTradingState(wallet);
        }

        const now = nowMs();
        if (now >= nextEpochCheck) {
            const epochWasValid = await runAssetEpochCheck(wallet);
            if (!epochWasValid) {
                await refreshTradingState(wallet);
            }
            nextEpochCheck = now + EPOCH_CHECK_MS;
        }

        if (now >= nextQuote || actions.tradeOccurred || actions.needsResync) {
            await runQuoteMaintenance(wallet);
            await refreshTradingState(wallet);
            nextQuote = now + jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS);
        }

        if (now >= nextAggression) {
            await runAggression(wallet);
            await refreshTradingState(wallet);
            nextAggression = now + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);
        }

    }
}

function processEvents(events: RuntimeEvent[]): {
    needsResync: boolean;
    marketChanged: boolean;
    tradeOccurred: boolean;
} {
    let needsResync = false;
    let marketChanged = false;
    let tradeOccurred = false;

    for (const event of events) {
        if (event.type === "market-resync") {
            needsResync = true;
            warn("market resync requested:", event.reason);
            continue;
        }

        if (event.type === "oracle-price") {
            STATE.oracle.connected = true;
            const estimate = updateFairValueFromOracle(event.update.price, event.update.ts);
            log("oracle state updated", {
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

        marketChanged = true;
        if (event.update.type === "trade") {
            tradeOccurred = true;
            applyTradeHint(event.update);
        }
    }

    return { needsResync, marketChanged, tradeOccurred };
}

function applyTradeHint(update: WebSocketTradeUpdate): void {
    const order = STATE.pending.get(update.data.orderId);
    if (!order) return;

    const fill = Number(update.data.fill);
    if (fill <= 0) return;

    STATE.invBase += order.side === "buy" ? fill : -fill;
    STATE.lastTradeTime = nowMs();
    log("order execution hint", {
        orderId: update.data.orderId,
        side: order.side,
        fill,
        fillPrice: Number(update.data.fillPrice),
        seqId: update.seqId.toString(),
    });
}
