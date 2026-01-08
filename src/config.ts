export type Side = "buy" | "sell";

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

function envBool(name: string, def: boolean): boolean {
    const v = process.env[name];
    if (v == null || v.trim() === "") return def;
    return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

export const CFG = {
    ORDERS_URL: envStr("ORDERS_URL", "https://exchange-api.gammaswap.com/api/orders"),
    CANCELS_URL: envStr("CANCELS_URL", "https://exchange-api.gammaswap.com/api/cancels"),
    BOOK_URL: envStr("BOOK_URL", "https://exchange-api.gammaswap.com/api/book/1"),
    PENDING_URL: envStr("PENDING_URL", "https://exchange-api.gammaswap.com/api/book/1/useraddress"),

    USER_ADDRESS: envStr("USER_ADDRESS", "useraddress"),
    API_KEY: envStr("API_KEY", ""),
    API_SECRET: envStr("API_SECRET", ""),

    HARD_MIN_PRICE: envNum("HARD_MIN_PRICE", 0.01),
    HARD_MAX_PRICE: envNum("HARD_MAX_PRICE", 0.99),
    SOFT_MIN_PRICE: envNum("SOFT_MIN_PRICE", 0.10),
    SOFT_MAX_PRICE: envNum("SOFT_MAX_PRICE", 0.90),
    CENTER_PRICE: envNum("CENTER_PRICE", 0.50),

    TICK_SIZE: envNum("TICK_SIZE", 0.001),

    LEVELS_PER_SIDE: Math.max(1, Math.floor(envNum("LEVELS_PER_SIDE", 5))),
    LEVEL_SPACING_NEAR: envNum("LEVEL_SPACING_NEAR", 0.002),
    LEVEL_SPACING_GROWTH: envNum("LEVEL_SPACING_GROWTH", 1.25),
    VARIABILITY_MIN: envNum("VARIABILITY_MIN", 0.85),
    VARIABILITY_MAX: envNum("VARIABILITY_MAX", 1.20),

    QUOTE_BASE_SIZE_MIN: envNum("QUOTE_BASE_SIZE_MIN", 10),
    QUOTE_BASE_SIZE_MAX: envNum("QUOTE_BASE_SIZE_MAX", 50),
    DEPTH_GROWTH: envNum("DEPTH_GROWTH", 1.35),

    MAX_PENDING_ORDERS: Math.max(2, Math.floor(envNum("MAX_PENDING_ORDERS", 40))),
    STALE_SECONDS: envNum("STALE_SECONDS", 180),
    CANCEL_BATCH_MAX: Math.max(1, Math.floor(envNum("CANCEL_BATCH_MAX", 10))),

    BOOK_REFRESH_MS: envNum("BOOK_REFRESH_MS", 1500),
    PENDING_REFRESH_MS: envNum("PENDING_REFRESH_MS", 4000),

    QUOTE_LOOP_MS: envNum("QUOTE_LOOP_MS", 30000),
    QUOTE_JITTER_MS: envNum("QUOTE_JITTER_MS", 5000),

    CANCEL_LOOP_MS: envNum("CANCEL_LOOP_MS", 30000),
    CANCEL_JITTER_MS: envNum("CANCEL_JITTER_MS", 5000),

    AGGRESS_MS: envNum("AGGRESS_MS", 120000),
    AGGRESS_JITTER_MS: envNum("AGGRESS_JITTER_MS", 12000),

    WIPE_LEVELS: Math.max(1, Math.floor(envNum("WIPE_LEVELS", 2))),
    SLIP_BUFFER: envNum("SLIP_BUFFER", 0.15),
    MAX_AGGRESS_QTY: envNum("MAX_AGGRESS_QTY", 500),
    EXTREME_PUSH_PROB: envNum("EXTREME_PUSH_PROB", 0.10),
    MEANREV_K: envNum("MEANREV_K", 2.0),

    USE_LOCAL_LEDGER: envBool("USE_LOCAL_LEDGER", true),
    START_BASE_BAL: envNum("START_BASE_BAL", 10000),
    START_QUOTE_BAL: envNum("START_QUOTE_BAL", 10000),

    BASE_RESERVE_MIN: envNum("BASE_RESERVE_MIN", 1500),
    QUOTE_RESERVE_MIN: envNum("QUOTE_RESERVE_MIN", 1500),

    INV_TARGET: envNum("INV_TARGET", 0),
    INV_MAX_ABS: envNum("INV_MAX_ABS", 5000),
    INV_SKEW_STRENGTH: envNum("INV_SKEW_STRENGTH", 0.35),

    LOG_VERBOSE: envBool("LOG_VERBOSE", true),
} as const;
