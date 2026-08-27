import { TradingBot } from "./runtime/tradingBot.js";
import { CFG, validateProductionConfig } from "./config/config.js";
import { log, warn } from "./utils/utils.js";

/**
 * CLI entry point and package-API example. Trading lifecycle initialization is
 * delegated to TradingBot so all users share the same startup behavior.
 */
async function main(): Promise<void> {
    const configurationErrors = validateProductionConfig();
    if (configurationErrors.length > 0) {
        for (const error of configurationErrors) warn("configuration error:", error);
        return;
    }

    const bot = new TradingBot({
        apiUrl: CFG.API_URL,
        assetId: CFG.ASSET_ID,
        chainId: CFG.CHAIN_ID,
        contracts: {
            exchange: CFG.EXCHANGE_ADDRESS,
            ledger: CFG.LEDGER_ADDRESS,
            settlementToken: CFG.SETTLEMENT_TOKEN,
            permit2: CFG.PERMIT2_ADDRESS,
            depositLedger: CFG.DEPOSIT_LEDGER_ADDRESS,
        },
        orderbookWsUrl: CFG.ORDERBOOK_WS_URL,
        fairValue: {
            oracleFeedWsUrl: CFG.ORACLE_FEED_WS_URL,
            enabled: CFG.USE_ORACLE_FAIR_VALUE,
            requireFreshValue: CFG.REQUIRE_FRESH_FAIR_VALUE,
            stalePriceTimeoutMs: CFG.ORACLE_STALE_PRICE_TIMEOUT_MS,
            firstPriceTimeoutMs: CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS,
            volatility: CFG.FAIR_VALUE_VOL,
            weight: CFG.FAIR_VALUE_WEIGHT,
            paysAboveStrike: CFG.FAIR_VALUE_PAYS_ABOVE_STRIKE,
        },
        aggression: {
            fairValueMinEdgeTicks: CFG.FAIR_VALUE_MIN_EDGE_TICKS,
        },
        quote: {
            levelsPerSide: CFG.LEVELS_PER_SIDE,
            ladderModel: CFG.LADDER_PRICE_MODEL === 2 ? "growth-space" : "equidistant",
            logitHalfSpread: CFG.LOGIT_HALF_SPREAD,
            quoteSizeConcavity: CFG.QUOTE_SIZE_CONCAVITY,
            tickSize: CFG.TICK_SIZE,
            lotSize: CFG.LOT_SIZE,
        },
        risk: {
            maxContractExposurePct: CFG.MAX_CONTRACT_EXPOSURE_PCT,
            maxCapitalExposurePct: CFG.MAX_CAPITAL_EXPOSURE_PERCENT,
            inventoryTarget: CFG.INV_TARGET,
            inventoryMaxAbs: CFG.INV_MAX_ABS,
        },
        timing: {
            quoteLoopMs: CFG.QUOTE_LOOP_MS,
            quoteJitterMs: CFG.QUOTE_JITTER_MS,
            aggressionMs: CFG.AGGRESS_MS,
            aggressionJitterMs: CFG.AGGRESS_JITTER_MS,
            bookStaleMs: CFG.BOOK_STALE_MS,
            fairValueStaleMs: CFG.FAIR_VALUE_STALE_MS,
        },
    });

    log("starting trading bot", { assetId: CFG.ASSET_ID });
    await bot.start();

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("received", signal, "stopping trading bot");
        void bot.stop().finally(() => process.exit(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch((error) => {
    console.error("fatal:", error);
    process.exit(1);
});
