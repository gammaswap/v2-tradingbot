export type Side = "buy" | "sell";
import {
    PROTOCOL_MIN_PRICE,
    PROTOCOL_MAX_PRICE,
    PROTOCOL_MIN_SIZE,
    PROTOCOL_MAX_SIZE,
    SDK_SIZE_STEP,
} from "../utils/protocolPrice.js";

const DEFAULT_ASSET_ID = "261336857817713630688382311349658711122006440411137";
const DEFAULT_TEST_MNEMONIC = "test test test test test test test test test test test junk";

function envNum(name: string, def: number): number {
    const v = process.env[name];
    if (v == null || v.trim() === "") return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

function envStr(name: string, def: string): string {
    const v = process.env[name];
    return v == null || v.trim() === "" ? def : v;
}

function envApiUrl(): string {
    const explicit = process.env.API_URL;
    if (explicit != null && explicit.trim() !== "") return explicit.trim();

    const endpointFallbacks = [
        { name: "ORDERS_URL", suffix: "/orders" },
        { name: "CANCELS_URL", suffix: "/cancels" },
        { name: "CLAIM_URL", suffix: "/claim" },
        { name: "BOOK_URL", suffix: "/book" },
        { name: "PENDING_URL", suffix: "/book" },
        { name: "BALANCE_URL", suffix: "/balance" },
        { name: "POSITION_URL", suffix: "/position" },
        { name: "RESOLUTION_URL", suffix: "/resolve" },
    ];

    for (const { name, suffix } of endpointFallbacks) {
        const value = process.env[name];
        const normalized = value?.trim().replace(/\/+$/, "");
        if (normalized != null && normalized !== "" && normalized.endsWith(suffix)) {
            return normalized.slice(0, -suffix.length);
        }
    }

    return "https://exchange-api.gammaswap.com/api";
}

function envBool(name: string, def: boolean): boolean {
    const v = process.env[name];
    if (v == null || v.trim() === "") return def;
    return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

function envBigInt(name: string, def: number): bigint {
    const v = process.env[name];
    if (v == null || v.trim() === "") return BigInt(def);
    const n = Number(v);
    return Number.isFinite(n) ? BigInt(n) : BigInt(def);
}

const ASSET_ID = envStr("ASSET_ID", DEFAULT_ASSET_ID);

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): string[] {
    const errors: string[] = [];
    errors.push(...validatePriceConfiguration());
    errors.push(...validateOrderSizeConfiguration());
    errors.push(...validateRiskConfiguration());
    const enabled = ["1", "true", "yes", "y", "on"].includes(
        (env.PRODUCTION_MODE ?? "").toLowerCase(),
    );
    if (!enabled) return errors;

    if (!env.MNEMONIC || env.MNEMONIC === DEFAULT_TEST_MNEMONIC) {
        errors.push("MNEMONIC must be explicitly configured and cannot use the test mnemonic");
    }
    if (!env.API_URL) {
        errors.push("API_URL must be explicitly configured for production");
    }
    if (!env.CHAIN_ID) errors.push("CHAIN_ID must be explicitly configured for production");
    if (!env.EXCHANGE_ADDRESS) errors.push("EXCHANGE_ADDRESS must be explicitly configured for production");
    if (!env.LEDGER_ADDRESS) errors.push("LEDGER_ADDRESS must be explicitly configured for production");

    return errors;
}

export function validatePriceConfiguration(config = CFG): string[] {
    const errors: string[] = [];
    const prices = [
        ["HARD_MIN_PRICE", config.HARD_MIN_PRICE],
        ["HARD_MAX_PRICE", config.HARD_MAX_PRICE],
        ["SOFT_MIN_PRICE", config.SOFT_MIN_PRICE],
        ["SOFT_MAX_PRICE", config.SOFT_MAX_PRICE],
        ["CENTER_PRICE", config.CENTER_PRICE],
    ] as const;

    for (const [name, value] of prices) {
        if (!Number.isSafeInteger(value)) {
            errors.push(`${name} must be a safe integer`);
            continue;
        }
        if (value < PROTOCOL_MIN_PRICE || value > PROTOCOL_MAX_PRICE) {
            errors.push(
                `${name} must be between ${PROTOCOL_MIN_PRICE} and ${PROTOCOL_MAX_PRICE}`,
            );
        }
    }

    if (config.HARD_MIN_PRICE > config.HARD_MAX_PRICE) {
        errors.push("HARD_MIN_PRICE must not exceed HARD_MAX_PRICE");
    }
    if (config.SOFT_MIN_PRICE > config.SOFT_MAX_PRICE) {
        errors.push("SOFT_MIN_PRICE must not exceed SOFT_MAX_PRICE");
    }
    if (config.SOFT_MIN_PRICE < config.HARD_MIN_PRICE) {
        errors.push("SOFT_MIN_PRICE must not be below HARD_MIN_PRICE");
    }
    if (config.SOFT_MAX_PRICE > config.HARD_MAX_PRICE) {
        errors.push("SOFT_MAX_PRICE must not exceed HARD_MAX_PRICE");
    }
    if (
        config.CENTER_PRICE < config.SOFT_MIN_PRICE ||
        config.CENTER_PRICE > config.SOFT_MAX_PRICE
    ) {
        errors.push("CENTER_PRICE must be between SOFT_MIN_PRICE and SOFT_MAX_PRICE");
    }

    return errors;
}

export function validateOrderSizeConfiguration(config = CFG): string[] {
    const errors: string[] = [];
    const sizes = [
        ["LOT_SIZE", config.LOT_SIZE],
        ["MAX_AGGRESS_QTY", config.MAX_AGGRESS_QTY],
        ["MAX_ORDER_SIZE", config.MAX_ORDER_SIZE],
    ] as const;

    for (const [name, value] of sizes) {
        if (!Number.isSafeInteger(value)) {
            errors.push(`${name} must be a safe integer`);
            continue;
        }
        if (value < PROTOCOL_MIN_SIZE || value > PROTOCOL_MAX_SIZE) {
            errors.push(`${name} must be between ${PROTOCOL_MIN_SIZE} and ${PROTOCOL_MAX_SIZE}`);
        }
        if (value % SDK_SIZE_STEP !== 0) {
            errors.push(`${name} must be a multiple of ${SDK_SIZE_STEP}`);
        }
    }

    if (config.MAX_AGGRESS_QTY > config.MAX_ORDER_SIZE) {
        errors.push("MAX_AGGRESS_QTY must not exceed MAX_ORDER_SIZE");
    }

    return errors;
}

export function validateRiskConfiguration(config = CFG): string[] {
    const errors: string[] = [];

    if (
        !Number.isFinite(config.MAX_CAPITAL_EXPOSURE_PERCENT) ||
        config.MAX_CAPITAL_EXPOSURE_PERCENT < 0 ||
        config.MAX_CAPITAL_EXPOSURE_PERCENT > 100
    ) {
        errors.push("MAX_CAPITAL_EXPOSURE_PERCENT must be between 0 and 100");
    }

    if (!Number.isFinite(config.BASE_RESERVE_MIN) || config.BASE_RESERVE_MIN < 0) {
        errors.push("BASE_RESERVE_MIN must be non-negative");
    }
    if (
        !Number.isFinite(config.RISK_AVERSION_GAMMA_0) ||
        config.RISK_AVERSION_GAMMA_0 <= 0
    ) {
        errors.push("RISK_AVERSION_GAMMA_0 must be positive");
    }
    if (
        !Number.isFinite(config.RISK_AVERSION_GAMMA_MAX) ||
        config.RISK_AVERSION_GAMMA_MAX <= config.RISK_AVERSION_GAMMA_0
    ) {
        errors.push("RISK_AVERSION_GAMMA_MAX must be greater than RISK_AVERSION_GAMMA_0");
    }
    if (!Number.isFinite(config.RISK_AVERSION_B) || config.RISK_AVERSION_B < 1) {
        errors.push("RISK_AVERSION_B must be at least 1");
    }
    if (
        !Number.isFinite(config.LOGIT_HALF_SPREAD) ||
        config.LOGIT_HALF_SPREAD < 0.005 ||
        config.LOGIT_HALF_SPREAD > 1
    ) {
        errors.push("LOGIT_HALF_SPREAD must be between 0.005 and 1");
    }
    if (
        !Number.isInteger(config.LEVELS_PER_SIDE) ||
        config.LEVELS_PER_SIDE < 1 ||
        config.LEVELS_PER_SIDE > 100
    ) {
        errors.push("LEVELS_PER_SIDE must be an integer between 1 and 100");
    }
    if (
        !Number.isInteger(config.LADDER_PRICE_MODEL) ||
        config.LADDER_PRICE_MODEL < 1 ||
        config.LADDER_PRICE_MODEL > 2
    ) {
        errors.push("LADDER_PRICE_MODEL must be either 1 or 2");
    }
    if (
        !Number.isFinite(config.QUOTE_SIZE_CONCAVITY) ||
        config.QUOTE_SIZE_CONCAVITY <= 0 ||
        config.QUOTE_SIZE_CONCAVITY > 10
    ) {
        errors.push("QUOTE_SIZE_CONCAVITY must be greater than 0 and at most 10");
    }
    if (
        !Number.isFinite(config.MAX_CONTRACT_EXPOSURE_PCT) ||
        config.MAX_CONTRACT_EXPOSURE_PCT < 1 ||
        config.MAX_CONTRACT_EXPOSURE_PCT > 100
    ) {
        errors.push("MAX_CONTRACT_EXPOSURE_PCT must be between 1 and 100");
    }
    if (
        !Number.isFinite(config.TOTAL_SIZE_DECAY_K) ||
        config.TOTAL_SIZE_DECAY_K <= 1
    ) {
        errors.push("TOTAL_SIZE_DECAY_K must be greater than 1");
    }
    if (
        !Number.isFinite(config.TOTAL_SIZE_DECAY_A) ||
        config.TOTAL_SIZE_DECAY_A <= 0 ||
        config.TOTAL_SIZE_DECAY_A >= 1
    ) {
        errors.push("TOTAL_SIZE_DECAY_A must be greater than 0 and less than 1");
    }
    if (
        !Number.isInteger(config.TOTAL_SIZE_TIME_BUCKET_SECONDS) ||
        config.TOTAL_SIZE_TIME_BUCKET_SECONDS < 1 ||
        config.TOTAL_SIZE_TIME_BUCKET_SECONDS > 30
    ) {
        errors.push(
            "TOTAL_SIZE_TIME_BUCKET_SECONDS must be an integer between 1 and 30",
        );
    }

    return errors;
}

export const CFG = {
    ASSET_ID,

    // ===============SDK Parameters===============
    API_URL: envApiUrl(),
    API_KEY: envStr("API_KEY", ""),
    API_SECRET: envStr("API_SECRET", ""),
    API_TIMEOUT_MS: envNum("API_TIMEOUT_MS", 30_000),
    MNEMONIC: envStr("MNEMONIC", DEFAULT_TEST_MNEMONIC),
    WALLET_INDEX: envNum("WALLET_INDEX", 0),
    CHAIN_ID: envNum("CHAIN_ID", 84532), // baseSepolia
    PERMIT2_ADDRESS: envStr("PERMIT2_ADDRESS", "0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    SETTLEMENT_TOKEN: envStr("SETTLEMENT_TOKEN", "0xdf3d36447b22e9feEe337765DdC413d09fA03bC2"),
    LEDGER_ADDRESS: envStr("LEDGER_ADDRESS", "0xF801fc13AA08876F343fEBf50dFfA52A78180811"),
    DEPOSIT_LEDGER_ADDRESS: envStr("DEPOSIT_LEDGER_ADDRESS", "0x06E54Aa21496Ed0099219ea79a2c72247F36091A"),
    EXCHANGE_ADDRESS: envStr("EXCHANGE_ADDRESS", ""),

    ORDERBOOK_WS_URL: envStr("ORDERBOOK_WS_URL", "wss://exchange-api.gammaswap.com/ws/"),
    // Maximum age, in milliseconds, for the last usable order-book update.
    // The strategy compares the current time with STATE.bookUpdatedAtMs. If
    // the book is older than this threshold, it is considered stale and the
    // bot pauses quoting until a fresh usable book update arrives.
    BOOK_STALE_MS: envNum("BOOK_STALE_MS", 45000),

    // ===============Fair Value Parameters===============
    ORACLE_FEED_WS_URL: envStr("ORACLE_FEED_WS_URL", "wss://exchange-api.gammaswap.com/oracle-ws/"),
    // Estimate of probability of contract winning based on Black-Scholes model
    // Fair-value model:
    //   tau = expiresInSec / secondsPerYear
    //   d2 = (ln(spot / strike) - 0.5 * volatility^2 * tau)
    //        / (volatility * sqrt(tau))
    //   P(spot >= strike at expiration) = NormalCDF(d2)
    // If the market pays below the strike, the probability is inverted:
    //   P(pays) = 1 - NormalCDF(d2)
    // The resulting probability is converted to protocol price units:
    //   fairValue = roundToTick(P(pays) * 1,000,000)
    FAIR_VALUE_VOL: envNum("FAIR_VALUE_VOL", 0.80),
    // Weight applied when combining the oracle-derived fair value with the
    // current order-book midpoint. The value is clamped to [0, 1]:
    //   referencePrice = weight * fairValue
    //                  + (1 - weight) * bookMid
    // A weight of 1 uses only the oracle fair value, while a weight of 0
    // uses only the book midpoint. The calculation is performed in the
    // protocol's price units, and the result is rounded to the nearest tick.
    // This result is the reference price used for quoting.
    FAIR_VALUE_WEIGHT: envNum("FAIR_VALUE_WEIGHT", 1.0),
    // When true means contract wins when price above strike
    FAIR_VALUE_PAYS_ABOVE_STRIKE: envBool("FAIR_VALUE_PAYS_ABOVE_STRIKE", true),
    // When enabled, the oracle price is used to estimate fair value and can
    // influence the quoting reference price and aggression decisions. When
    // disabled, the oracle feed and fair-value model are not used; quoting
    // continues from a fresh order-book midpoint and aggression uses its
    // non-oracle fallback model.
    USE_ORACLE_FAIR_VALUE: envBool("USE_ORACLE_FAIR_VALUE", true),
    // Ongoing oracle-stream timeout. If no oracle update arrives during this
    // interval, the SDK marks the subscription stale, STATE.oracle.stale is
    // set to true, and the fair value is no longer considered usable.
    ORACLE_STALE_PRICE_TIMEOUT_MS: envNum("ORACLE_STALE_PRICE_TIMEOUT_MS", 30000),
    // Startup timeout for receiving the first oracle price after subscribing.
    // When fresh fair value is required, failure to receive that first price
    // within this interval prevents the bot from starting its coordinator.
    ORACLE_FIRST_PRICE_TIMEOUT_MS: envNum("ORACLE_FIRST_PRICE_TIMEOUT_MS", 30000),
    // Only applies when USE_ORACLE_FAIR_VALUE is enabled. If true, trading
    // pauses until a fresh oracle fair value is available; if false, the bot
    // may fall back to a fresh order-book midpoint.
    REQUIRE_FRESH_FAIR_VALUE: envBool("REQUIRE_FRESH_FAIR_VALUE", true),
    // Maximum age of STATE.fairValue.updatedAtMs before the fair value is
    // considered stale. A fair value is fresh when the current time minus
    // updatedAtMs is less than or equal to this value. This is separate from
    // ORACLE_STALE_PRICE_TIMEOUT_MS, which detects an inactive websocket.
    FAIR_VALUE_STALE_MS: envNum("FAIR_VALUE_STALE_MS", 45000),

    // ===============Aggression logic=================
    AGGRESS_MS: envNum("AGGRESS_MS", 300000),
    AGGRESS_JITTER_MS: envNum("AGGRESS_JITTER_MS", 12000),
    WIPE_LEVELS: Math.max(1, Math.floor(envNum("WIPE_LEVELS", 2))),
    SLIP_BUFFER: envNum("SLIP_BUFFER", 0.15),
    MAX_AGGRESS_QTY: envNum("MAX_AGGRESS_QTY", 500*1000000),
    EXTREME_PUSH_PROB: envNum("EXTREME_PUSH_PROB", 0.10),
    MEANREV_K: envNum("MEANREV_K", 2.0),
    INV_SKEW_STRENGTH: envNum("INV_SKEW_STRENGTH", 0.35),
    CENTER_PRICE: envNum("CENTER_PRICE", 500000), // 50.0 cents ($0.50)
    // Number of protocol price ticks required for a fair-value trade edge.
    FAIR_VALUE_MIN_EDGE_TICKS: envNum("FAIR_VALUE_MIN_EDGE_TICKS", 2),

    // ============Collateral availability for order placement===============
    // These two settings work together. The available collateral used by the
    // order planner is the smaller of:
    //   1. the percentage-based limit below, and
    //   2. the balance remaining after BASE_RESERVE_MIN is withheld.
    // MAX_CAPITAL_EXPOSURE_PERCENT is therefore a proportional usage limit;
    // it does not limit contract exposure and does not preserve a fixed
    // dollar balance by itself.
    MAX_CAPITAL_EXPOSURE_PERCENT: envNum("MAX_CAPITAL_EXPOSURE_PERCENT", 70),
    // Absolute balance that the order planner must leave unused. This is the
    // hard collateral floor and complements the percentage-based limit above.
    BASE_RESERVE_MIN: envNum("BASE_RESERVE_MIN", 1500 * 1000000),

    // ============Quote Price Parameters===============
    RISK_AVERSION_GAMMA_0: envNum("RISK_AVERSION_GAMMA_0", 1e-9),
    RISK_AVERSION_GAMMA_MAX: envNum("RISK_AVERSION_GAMMA_MAX", 1e-8),
    RISK_AVERSION_B: envNum("RISK_AVERSION_B", 5),
    // Half-spread in logit terms. Approximate decimal-price half-spread near
    // probability p: p * (1 - p) * LOGIT_HALF_SPREAD.
    LOGIT_HALF_SPREAD: envNum("LOGIT_HALF_SPREAD", 0.5),

    // ============Quote Size Parameters============
    // Controls how strongly size is concentrated at prices farthest from the
    // best bid or ask. 1 is linear; values above 1 emphasize outer levels.
    QUOTE_SIZE_CONCAVITY: envNum("QUOTE_SIZE_CONCAVITY", 1),
    // Maximum contract allocation as a percentage of account balance. Both
    // bid and ask totals are capped independently at this allocation.
    MAX_CONTRACT_EXPOSURE_PCT: envNum("MAX_CONTRACT_EXPOSURE_PCT", 5),
    // Values greater than 1 keep total size near its initial level for longer.
    TOTAL_SIZE_DECAY_K: envNum("TOTAL_SIZE_DECAY_K", 2),
    // Values between 0 and 1 control how violently size collapses near expiration.
    TOTAL_SIZE_DECAY_A: envNum("TOTAL_SIZE_DECAY_A", 0.5),
    // Recalculate bucketed remaining time only at these intervals.
    TOTAL_SIZE_TIME_BUCKET_SECONDS: envNum("TOTAL_SIZE_TIME_BUCKET_SECONDS", 5),

    // ==========Quote Ladder Parameters==============
    LEVELS_PER_SIDE: envNum("LEVELS_PER_SIDE", 5),
    LADDER_PRICE_MODEL: envNum("LADDER_PRICE_MODEL", 1),
    QUOTE_LOOP_MS: envNum("QUOTE_LOOP_MS", 10000),
    QUOTE_JITTER_MS: envNum("QUOTE_JITTER_MS", 5000),

    // Prices use protocol units: 1,000 = 0.1 cents ($0.001), and
    // 1,000,000 = 100 cents ($1.00). These values are not SDK decimals.
    HARD_MIN_PRICE: envNum("HARD_MIN_PRICE", 1000), // 0.1 cents ($0.001)
    HARD_MAX_PRICE: envNum("HARD_MAX_PRICE", 999000), // 99.9 cents ($0.999)
    SOFT_MIN_PRICE: envNum("SOFT_MIN_PRICE", 300000), // 30.0 cents ($0.30)
    SOFT_MAX_PRICE: envNum("SOFT_MAX_PRICE", 700000), // 70.0 cents ($0.70)

    // ========Quote Growth Space Ladder Parameters==============
    // Initial ladder distance in protocol price units. The default 2,000
    // equals 0.2 cents ($0.002).
    LEVEL_SPACING_NEAR: envNum("LEVEL_SPACING_NEAR", 2000),
    LEVEL_SPACING_GROWTH: envNum("LEVEL_SPACING_GROWTH", 1.5),

    INV_TARGET: envNum("INV_TARGET", 0),
    INV_MAX_ABS: envNum("INV_MAX_ABS", 5000 * 1000000),

    // Duration that a quote slot remains paused after a terminal order
    // failure, such as a rejected placement or failed replacement. This
    // prevents the next quote-maintenance pass from immediately resubmitting
    // the same slot while the market or account conditions may still be bad.
    ORDER_FAILURE_COOLDOWN_MS: envNum("ORDER_FAILURE_COOLDOWN_MS", 5_000),
    // Protocol price-unit increment. The default 1,000 equals 0.1 cents.
    TICK_SIZE: envNum("TICK_SIZE", 1000),
    LOT_SIZE: envNum("LOT_SIZE", 10000),// 0.01
    MAX_ORDER_SIZE: envNum("MAX_ORDER_SIZE", 100000 * 1000000), // Protocol level limit
    DUST_BALANCE: envBigInt("DUST_BALANCE", 1000000), // 1
    LOG_VERBOSE: envBool("LOG_VERBOSE", true),
    LOG_DEBUG: envBool("LOG_DEBUG", false),
} as const;
