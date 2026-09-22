import { type TradingBotOptions, validateTradingBotOptions } from "../index.js";
import { CFG, validateProductionConfig } from "../config/config.js";
import { resolveTradingWallet } from "../runtime/wallet.js";

function defaultControlSocketPath(): string {
  const botName = (process.env.BOT_NAME || "default-bot").replace(/[^a-zA-Z0-9_-]/g, "-");
  const directory = process.env.CONTROL_SOCKET_DIR || "/tmp";
  return `${directory}/gammaswap-${botName.endsWith("-bot") ? botName : `${botName}-bot`}.sock`;
}

/**
 * Builds the standalone runner's bot options from process environment
 * variables. Imported applications should construct TradingBotOptions
 * themselves rather than relying on this repository deployment helper.
 */
export function createBotOptionsFromEnvironment(): TradingBotOptions {
  const configurationErrors = validateProductionConfig();
  if (configurationErrors.length > 0) {
    throw new Error(`invalid environment configuration: ${configurationErrors.join("; ")}`);
  }

  const options: TradingBotOptions = {
    wallet: resolveTradingWallet(),
    logLevel: CFG.LOG_LEVEL,
    isTaker: CFG.IS_TAKER,
    apiUrl: CFG.API_URL,
    api: {
      key: CFG.API_KEY,
      secret: CFG.API_SECRET,
      timeoutMs: CFG.API_TIMEOUT_MS,
    },
    assetId: CFG.ASSET_ID,
    controlSocketPath: process.env.CONTROL_SOCKET_PATH || defaultControlSocketPath(),
    chainId: CFG.CHAIN_ID,
    contracts: {
      exchange: CFG.EXCHANGE_ADDRESS,
      ledger: CFG.LEDGER_ADDRESS,
      settlementToken: CFG.SETTLEMENT_TOKEN,
      permit2: CFG.PERMIT2_ADDRESS,
      depositLedger: CFG.DEPOSIT_LEDGER_ADDRESS,
    },
    orderbookWsUrl: CFG.ORDERBOOK_WS_URL,
    bookStaleMs: CFG.BOOK_STALE_MS,
    hardMinPrice: CFG.HARD_MIN_PRICE,
    hardMaxPrice: CFG.HARD_MAX_PRICE,
    dustBalance: CFG.DUST_BALANCE,
    maxOrderSize: CFG.MAX_ORDER_SIZE,
    fairValue: {
      oracleFeedWsUrl: CFG.ORACLE_FEED_WS_URL,
      enabled: CFG.USE_ORACLE_FAIR_VALUE,
      requireFreshValue: CFG.REQUIRE_FRESH_FAIR_VALUE,
      stalePriceTimeoutMs: CFG.ORACLE_STALE_PRICE_TIMEOUT_MS,
      firstPriceTimeoutMs: CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS,
      fairValueStaleMs: CFG.FAIR_VALUE_STALE_MS,
      volatility: CFG.FAIR_VALUE_VOL,
      weight: CFG.FAIR_VALUE_WEIGHT,
      paysAboveStrike: CFG.FAIR_VALUE_PAYS_ABOVE_STRIKE,
    },
    aggression: {
      model: CFG.AGGRESSION_MODEL,
      aggressionMs: CFG.AGGRESS_MS,
      aggressionJitterMs: CFG.AGGRESS_JITTER_MS,
      fairValueMinEdgeTicks: CFG.FAIR_VALUE_MIN_EDGE_TICKS,
      centerPrice: CFG.AGGRESSION_CENTER_PRICE,
      upperAnchorPrice: CFG.AGGRESSION_UPPER_ANCHOR_PRICE,
      wipeLevels: CFG.WIPE_LEVELS,
      slipBuffer: CFG.SLIP_BUFFER,
      maxAggressQty: CFG.MAX_AGGRESS_QTY,
      meanReversionK: CFG.MEANREV_K,
      inventorySkewStrength: CFG.INV_SKEW_STRENGTH,
      extremePushProbability: CFG.EXTREME_PUSH_PROB,
    },
    quote: {
      quoteLoopMs: CFG.QUOTE_LOOP_MS,
      quoteJitterMs: CFG.QUOTE_JITTER_MS,
      orderFailureCooldownMs: CFG.ORDER_FAILURE_COOLDOWN_MS,
      riskAversionGamma0: CFG.RISK_AVERSION_GAMMA_0,
      riskAversionGammaMax: CFG.RISK_AVERSION_GAMMA_MAX,
      riskAversionB: CFG.RISK_AVERSION_B,
      totalSizeDecayK: CFG.TOTAL_SIZE_DECAY_K,
      totalSizeDecayA: CFG.TOTAL_SIZE_DECAY_A,
      totalSizeTimeBucketSeconds: CFG.TOTAL_SIZE_TIME_BUCKET_SECONDS,
      levelsPerSide: CFG.LEVELS_PER_SIDE,
      ladderModel: CFG.LADDER_PRICE_MODEL === 2 ? "growth-space" : "equidistant",
      levelSpacingNear: CFG.LEVEL_SPACING_NEAR,
      levelSpacingGrowth: CFG.LEVEL_SPACING_GROWTH,
      logitHalfSpread: CFG.LOGIT_HALF_SPREAD,
      quoteSizeConcavity: CFG.QUOTE_SIZE_CONCAVITY,
    },
    risk: {
      maxContractExposurePct: CFG.MAX_CONTRACT_EXPOSURE_PCT,
      maxCapitalExposurePct: CFG.MAX_CAPITAL_EXPOSURE_PERCENT,
      baseReserveMin: CFG.BASE_RESERVE_MIN,
      inventoryTarget: CFG.INV_TARGET,
      inventoryMaxAbs: CFG.INV_MAX_ABS,
    },
  };

  const optionErrors = validateTradingBotOptions(options);
  if (optionErrors.length > 0) {
    throw new Error(`invalid bot options from environment: ${optionErrors.join("; ")}`);
  }

  return options;
}
