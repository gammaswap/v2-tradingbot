export type Side = "buy" | "sell";
import {
    PROTOCOL_MIN_PRICE,
    PROTOCOL_MAX_PRICE,
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

function symbolIdFromAssetId(assetId: string): string {
    try {
        return (BigInt(assetId) & ((1n << 64n) - 1n)).toString();
    } catch {
        return "1";
    }
}

const ASSET_ID = envStr("ASSET_ID", DEFAULT_ASSET_ID);

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): string[] {
    const errors: string[] = [];
    errors.push(...validatePriceConfiguration());
    const enabled = ["1", "true", "yes", "y", "on"].includes(
        (env.PRODUCTION_MODE ?? "").toLowerCase(),
    );
    if (!enabled) return errors;

    if (!env.MNEMONIC || env.MNEMONIC === DEFAULT_TEST_MNEMONIC) {
        errors.push("MNEMONIC must be explicitly configured and cannot use the test mnemonic");
    }
    if (!env.RPC_URL || env.RPC_URL === "http://localhost:8545") {
        errors.push("RPC_URL must be explicitly configured for production");
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

export const CFG = {
    RPC_URL: envStr("RPC_URL", "http://localhost:8545"),
    API_URL: envApiUrl(),
    API_TIMEOUT_MS: envNum("API_TIMEOUT_MS", 30_000),
    ORDER_FAILURE_COOLDOWN_MS: envNum("ORDER_FAILURE_COOLDOWN_MS", 5_000),
    PRODUCTION_MODE: envBool("PRODUCTION_MODE", false),
    ORDERBOOK_WS_URL: envStr("ORDERBOOK_WS_URL", "wss://exchange-api.gammaswap.com/ws/"),
    ORACLE_FEED_WS_URL: envStr("ORACLE_FEED_WS_URL", "wss://exchange-api.gammaswap.com/oracle-ws/"),
    ORDERS_URL: envStr("ORDERS_URL", "https://exchange-api.gammaswap.com/api/orders"),
    CANCELS_URL: envStr("CANCELS_URL", "https://exchange-api.gammaswap.com/api/cancels"),
    CLAIM_URL: envStr("CLAIM_URL", "https://exchange-api.gammaswap.com/api/claim"),
    DEPOSITS_URL: envStr("DEPOSITS_URL", "https://exchange-api.gammaswap.com/api/deposits"),
    BOOK_URL: envStr("BOOK_URL", "https://exchange-api.gammaswap.com/api/book"),
    PENDING_URL: envStr("PENDING_URL", "https://exchange-api.gammaswap.com/api/book"),
    RESOLUTION_URL: envStr("RESOLUTION_URL", "https://exchange-api.gammaswap.com/api/resolve"),
    BALANCE_URL: envStr("BALANCE_URL", "https://exchange-api.gammaswap.com/api/balance"),
    POSITION_URL: envStr("POSITION_URL", "https://exchange-api.gammaswap.com/api/position"),
    ASSET_ID,
    EPOCH: envStr("EPOCH", "0"),
    USER_ADDRESS: envStr("USER_ADDRESS", "0xa829c1D4542F70714B35fFe95a247373329131df"),

    API_KEY: envStr("API_KEY", ""),
    API_SECRET: envStr("API_SECRET", ""),
    MNEMONIC: envStr("MNEMONIC", DEFAULT_TEST_MNEMONIC),
    WALLET_INDEX: envNum("WALLET_INDEX", 0),
    CHAIN_ID: envNum("CHAIN_ID", 84532), // baseSepolia
    PERMIT2_ADDRESS: envStr("PERMIT2_ADDRESS", "0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    SETTLEMENT_TOKEN: envStr("SETTLEMENT_TOKEN", "0xdf3d36447b22e9feEe337765DdC413d09fA03bC2"),
    LEDGER_ADDRESS: envStr("LEDGER_ADDRESS", "0xF801fc13AA08876F343fEBf50dFfA52A78180811"),
    DEPOSIT_LEDGER_ADDRESS: envStr("DEPOSIT_LEDGER_ADDRESS", "0x06E54Aa21496Ed0099219ea79a2c72247F36091A"),
    EXCHANGE_ADDRESS: envStr("EXCHANGE_ADDRESS", ""),
    VERIFYING_ADDRESS: envStr("VERIFYING_ADDRESS", ""),

    HARD_MIN_PRICE: envNum("HARD_MIN_PRICE", 100000), // 0.1
    HARD_MAX_PRICE: envNum("HARD_MAX_PRICE", 900000), // 0.9
    SOFT_MIN_PRICE: envNum("SOFT_MIN_PRICE", 300000), // 0.3
    SOFT_MAX_PRICE: envNum("SOFT_MAX_PRICE", 700000), // 0.7
    CENTER_PRICE: envNum("CENTER_PRICE", 500000), // 0.5
    DUST_BALANCE: envBigInt("DUST_BALANCE", 1000000), // 1

    USE_ORACLE_FAIR_VALUE: envBool("USE_ORACLE_FAIR_VALUE", true),
    REQUIRE_FRESH_FAIR_VALUE: envBool("REQUIRE_FRESH_FAIR_VALUE", true),
    SYMBOL_ID: envStr("SYMBOL_ID", symbolIdFromAssetId(ASSET_ID)),
    ORACLE_STALE_PRICE_TIMEOUT_MS: envNum("ORACLE_STALE_PRICE_TIMEOUT_MS", 30000),
    ORACLE_FIRST_PRICE_TIMEOUT_MS: envNum("ORACLE_FIRST_PRICE_TIMEOUT_MS", 30000),
    FAIR_VALUE_STALE_MS: envNum("FAIR_VALUE_STALE_MS", 45000),
    FAIR_VALUE_VOL: envNum("FAIR_VALUE_VOL", 0.80),
    FAIR_VALUE_WEIGHT: envNum("FAIR_VALUE_WEIGHT", 1.0),
    FAIR_VALUE_MIN_EDGE_TICKS: envNum("FAIR_VALUE_MIN_EDGE_TICKS", 2),
    FAIR_VALUE_PAYS_ABOVE_STRIKE: envBool("FAIR_VALUE_PAYS_ABOVE_STRIKE", true),

    TICK_SIZE: envNum("TICK_SIZE", 1000),// 0.001
    LOT_SIZE: envNum("LOT_SIZE", 10000),// 0.01

    LEVELS_PER_SIDE: Math.max(1, Math.floor(envNum("LEVELS_PER_SIDE", 5))),
    LEVEL_SPACING_NEAR: envNum("LEVEL_SPACING_NEAR", 2000), // 0.002
    LEVEL_SPACING_GROWTH: envNum("LEVEL_SPACING_GROWTH", 1.5),
    VARIABILITY_MIN: envNum("VARIABILITY_MIN", 0.85),
    VARIABILITY_MAX: envNum("VARIABILITY_MAX", 1.20),

    QUOTE_BASE_SIZE_MIN: envNum("QUOTE_BASE_SIZE_MIN", 10*1000000), // 10
    QUOTE_BASE_SIZE_MAX: envNum("QUOTE_BASE_SIZE_MAX", 50*1000000), // 50
    DEPTH_GROWTH: envNum("DEPTH_GROWTH", 1.35),

    MAX_PENDING_ORDERS: Math.max(2, Math.floor(envNum("MAX_PENDING_ORDERS", 40))),
    STALE_SECONDS: envNum("STALE_SECONDS", 180),
    CANCEL_BATCH_MAX: Math.max(1, Math.floor(envNum("CANCEL_BATCH_MAX", 10))),

    BOOK_REFRESH_MS: envNum("BOOK_REFRESH_MS", 1500),
    PENDING_REFRESH_MS: envNum("PENDING_REFRESH_MS", 4000),

    QUOTE_LOOP_MS: envNum("QUOTE_LOOP_MS", 10000),
    QUOTE_JITTER_MS: envNum("QUOTE_JITTER_MS", 5000),

    CANCEL_LOOP_MS: envNum("CANCEL_LOOP_MS", 30000),
    CANCEL_JITTER_MS: envNum("CANCEL_JITTER_MS", 5000),

    AGGRESS_MS: envNum("AGGRESS_MS", 300000),
    AGGRESS_JITTER_MS: envNum("AGGRESS_JITTER_MS", 12000),

    WIPE_LEVELS: Math.max(1, Math.floor(envNum("WIPE_LEVELS", 2))),
    SLIP_BUFFER: envNum("SLIP_BUFFER", 0.15),
    MAX_AGGRESS_QTY: envNum("MAX_AGGRESS_QTY", 500*1000000),
    EXTREME_PUSH_PROB: envNum("EXTREME_PUSH_PROB", 0.10),
    MEANREV_K: envNum("MEANREV_K", 2.0),

    USE_LOCAL_LEDGER: envBool("USE_LOCAL_LEDGER", true),
    START_BASE_BAL: envNum("START_BASE_BAL", 10000 * 1000000),
    START_QUOTE_BAL: envNum("START_QUOTE_BAL", 10000 * 1000000),
    BASE_RESERVE_MIN: envNum("BASE_RESERVE_MIN", 1500 * 1000000),

    INV_TARGET: envNum("INV_TARGET", 0),
    INV_MAX_ABS: envNum("INV_MAX_ABS", 5000 * 1000000),
    INV_SKEW_STRENGTH: envNum("INV_SKEW_STRENGTH", 0.35),

    LOG_VERBOSE: envBool("LOG_VERBOSE", true),
    LOG_DEBUG: envBool("LOG_DEBUG", false),
} as const;
