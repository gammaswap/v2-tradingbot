import { CFG, type Side } from "../config/config.js";
import type { Asset, BookSnapshot, PendingOrder } from "../utils/types.js";
import { STATE } from "./state.js";
import { clamp, nowMs, randBetween, roundDownToOrderLot, roundToTick, tanh } from "../utils/utils.js";
import { protocolNotional, protocolNotionalBigInt, protocolValueToSafeNumber } from "../utils/protocolMath.js";
import {
    maxSizeForMargin,
    PROTOCOL_MIN_PRICE,
    PROTOCOL_MAX_PRICE,
    PROTOCOL_MIN_SIZE,
} from "../utils/protocolPrice.js";

const PROTOCOL_PRICE_SCALE = 1_000_000;

export function bestBidAsk(book: BookSnapshot | null): { bid: number | null; ask: number | null } {
    if (!book) return { bid: null, ask: null };
    return {
        bid: book.bids?.length ? Number(book.bids[0].price) : null,
        ask: book.asks?.length ? Number(book.asks[0].price) : null,
    };
}

export function midPrice(book: BookSnapshot | null): number {
    const { bid, ask } = bestBidAsk(book);
    if (bid != null && ask != null) return (bid + ask) / 2;
    if (bid != null) return bid;
    if (ask != null) return ask;
    return STATE.lastMid;
}

export function hasFreshFairValue(): boolean {
    if (!CFG.USE_ORACLE_FAIR_VALUE || !STATE.fairValue || STATE.oracle.stale) return false;
    return nowMs() - STATE.fairValue.updatedAtMs <= CFG.FAIR_VALUE_STALE_MS;
}

export function shouldPauseForFairValue(): boolean {
    return CFG.USE_ORACLE_FAIR_VALUE && CFG.REQUIRE_FRESH_FAIR_VALUE && !hasFreshFairValue();
}

export function shouldCancelReplace(o: PendingOrder, newPrice: number, newSize: number, tolTicks: number = 1) : boolean {
    const tol = CFG.TICK_SIZE * tolTicks + 1;//1e-12;
    const tolSize = 10000 * 1000; // 10 USD = $0.01 x 1000
    if (
        Math.abs(o.price - newPrice) <= tol &&
        Math.abs(o.size - newSize) <= tolSize
    ) {
        return false;
    }

    return true;
}

export function referencePrice(book: BookSnapshot | null): number {
    const bookMid = midPrice(book);
    if (!hasFreshFairValue()) return bookMid;

    const weight = clamp(CFG.FAIR_VALUE_WEIGHT, 0, 1);
    const fairValue = STATE.fairValue?.protocolPrice ?? bookMid;
    const blended = weight * fairValue + (1 - weight) * bookMid;
    return roundToNearestTick(clamp(blended, 0, 1000000));
}

/**
 * Calculates the time-dependent risk-aversion factor using:
 *
 *   gamma = gamma_0 + (gamma_max - gamma_0) * (1 - t / T)^B
 *
 * gamma_0 is the starting risk-aversion level and the lowest level in the
 * model. gamma_max is the maximum risk-aversion level. T is the total number
 * of seconds in the prediction-market epoch, t is the number of seconds
 * remaining until expiration, and B controls the curve shape. B must be at
 * least 1. At the start of the epoch, t equals T and gamma equals gamma_0;
 * at expiration, t equals 0 and gamma reaches gamma_max.
 */
export function calculateRiskAversionFactor(
    gamma_0: number,
    gamma_max: number,
    t: number,
    T: number,
    B: number,
): number {
    if (!Number.isFinite(gamma_0) || gamma_0 <= 0) {
        throw new Error(`gamma_0 must be positive: ${gamma_0}`);
    }
    if (!Number.isFinite(gamma_max) || gamma_max <= gamma_0) {
        throw new Error(`gamma_max must be greater than gamma_0: ${gamma_max}`);
    }
    if (!Number.isFinite(T) || T <= 0) {
        throw new Error(`T must be positive: ${T}`);
    }
    if (!Number.isFinite(t) || t < 0 || t > T) {
        throw new Error(`t must be between 0 and T: ${t}`);
    }
    if (!Number.isFinite(B) || B < 1) {
        throw new Error(`B must be at least 1: ${B}`);
    }

    return gamma_0 + (gamma_max - gamma_0) * Math.pow(1 - t / T, B);
}

export function calculateRemainingEpochSeconds(
    asset: Asset,
    timestampMs = Date.now(),
): { periodLength: number; remainingSeconds: number } {
    const periodLength = STATE.periodLength;
    if (periodLength === null) {
        throw new Error("epoch periodLength has not been initialized");
    }

    const nowSeconds = BigInt(Math.floor(timestampMs / 1000));
    const periodLengthBigInt = BigInt(periodLength);
    const rawRemaining = asset.expiration > nowSeconds
        ? asset.expiration - nowSeconds
        : 0n;
    const boundedRemaining = rawRemaining > periodLengthBigInt
        ? periodLengthBigInt
        : rawRemaining;

    return {
        periodLength,
        remainingSeconds: Number(boundedRemaining),
    };
}

export function calculateCurrentRiskAversion(
    asset: Asset,
    timestampMs = Date.now(),
): number {
    const { periodLength, remainingSeconds } =
        calculateRemainingEpochSeconds(asset, timestampMs);

    return calculateRiskAversionFactor(
        CFG.RISK_AVERSION_GAMMA_0,
        CFG.RISK_AVERSION_GAMMA_MAX,
        remainingSeconds,
        periodLength,
        CFG.RISK_AVERSION_B,
    );
}

export function calculateBidAndAsk(
    referencePrice: number,
    inventorySkew: number,
    halfSpread: number,
): { bid: number; ask: number } {
    if (
        !Number.isFinite(referencePrice) ||
        referencePrice <= 0 ||
        referencePrice >= PROTOCOL_PRICE_SCALE
    ) {
        throw new Error(
            `referencePrice must be between 0 and ${PROTOCOL_PRICE_SCALE}: ${referencePrice}`,
        );
    }
    if (!Number.isFinite(inventorySkew)) {
        throw new Error(`inventorySkew must be finite: ${inventorySkew}`);
    }
    if (!Number.isFinite(halfSpread) || halfSpread < 0.005 || halfSpread > 1) {
        throw new Error(`halfSpread must be between 0.005 and 1: ${halfSpread}`);
    }

    const p = referencePrice / PROTOCOL_PRICE_SCALE;
    const logitP = Math.log(p / (1 - p));
    const skewedLogitP = logitP - inventorySkew;
    const logitBid = skewedLogitP - halfSpread;
    const logitAsk = skewedLogitP + halfSpread;

    return {
        bid: 1 / (1 + Math.exp(-logitBid)),
        ask: 1 / (1 + Math.exp(-logitAsk)),
    };
}

/**
 * Calculates the inventory skew using:
 *
 *   skew = gamma * q * V = gamma * q * p * (1 - p)
 *
 * gamma is the risk-aversion factor, q is inventory (positive for long,
 * negative for short), p is the normalized reference price, and V is the
 * inventory variance. Because this is a binary prediction market, the
 * settlement follows a Bernoulli distribution, whose variance is p * (1 - p).
 */
export function calculateInventorySkew(
    gamma: number,
    inventory: number,
    referencePrice: number,
): number {
    if (!Number.isFinite(gamma)) {
        throw new Error(`gamma must be finite: ${gamma}`);
    }

    if (!Number.isFinite(inventory)) {
        throw new Error(`inventory must be finite: ${inventory}`);
    }

    if (
        !Number.isFinite(referencePrice) ||
        referencePrice < 0 ||
        referencePrice > PROTOCOL_PRICE_SCALE
    ) {
        throw new Error(
            `referencePrice must be between 0 and ${PROTOCOL_PRICE_SCALE}: ${referencePrice}`,
        );
    }

    const normalizedReferencePrice = referencePrice / PROTOCOL_PRICE_SCALE;

    return (
        gamma *
        inventory *
        normalizedReferencePrice *
        (1 - normalizedReferencePrice)
    );
}

export function depthToWipe(book: BookSnapshot, side: Side, levels: number): { qty: number; notional: number } {
    const arr = side === "buy" ? book.asks : book.bids;
    let qty = 0;
    let notional = 0n;
    for (let i = 0; i < Math.min(levels, arr.length); i++) {
        const size = Number(arr[i].size);
        const price = Number(arr[i].price);
        qty += size;
        notional += protocolNotionalBigInt(size, price);
    }
    return {
        qty,
        notional: protocolValueToSafeNumber(notional, "depth notional"),
    };
}

export function nearestOrderAtPrice(pending: Map<string, PendingOrder>, side: Side, price: number, tolTicks = 1) {
    const tol = CFG.TICK_SIZE * tolTicks + 1;//1e-12;
    for (const o of pending.values()) {
        if (o.side !== side) {
            continue;
        }
        if (Math.abs(o.price - price) <= tol) {
            return o;
        }
    }
    return null;
}

export function buildTargetLadderPrices(
    mid: number,
    book: BookSnapshot | null = null,
): { bids: number[]; asks: number[] } {
    console.log("===============buildTargetLadderPrices:start==================");
    const bidPrices = new Set<number>();
    const askPrices = new Set<number>();
    const bestAsk = book?.asks[0]?.price ?? null;
    const bestBid = book?.bids[0]?.price ?? null;
    let spacing = CFG.LEVEL_SPACING_NEAR;
    console.log("mid:", mid);
    console.log("spacing:", spacing);

    for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
        console.log("level:i:",i,"spacing:",spacing)
        const bidP = roundToTick(mid - spacing, "buy");
        const askP = roundToTick(mid + spacing, "sell");

        if (
            bidP >= CFG.HARD_MIN_PRICE &&
            bidP <= CFG.HARD_MAX_PRICE &&
            bidP >= PROTOCOL_MIN_PRICE &&
            bidP <= PROTOCOL_MAX_PRICE &&
            (bestAsk == null || bidP < bestAsk)
        ) {
            bidPrices.add(bidP);
        }

        if (
            askP >= CFG.HARD_MIN_PRICE &&
            askP <= CFG.HARD_MAX_PRICE &&
            askP >= PROTOCOL_MIN_PRICE &&
            askP <= PROTOCOL_MAX_PRICE &&
            (bestBid == null || askP > bestBid)
        ) {
            askPrices.add(askP);
        }

        spacing *= CFG.LEVEL_SPACING_GROWTH;
    }

    console.log("===============buildTargetLadderPrices:end==================");
    return { bids: [...bidPrices], asks: [...askPrices] };
}

/**
 * Builds equidistant quote slots between the calculated bid/ask and the
 * nearer/farther side of the reference price and current book midpoint.
 * The calculated bid/ask are normalized probabilities, so they are converted
 * to protocol price units before interpolation with the book and reference.
 * inventorySkew is already included in calculateBidAndAsk and is validated
 * here only because it is part of this function's quote-calculation inputs.
 */
export function buildTargetLadderPrices2(
    book: BookSnapshot,
    refPrice: number,
    inventorySkew: number,
    bid: number,
    ask: number,
): { bids: number[]; asks: number[] } {
    if (!Number.isFinite(refPrice)) {
        throw new Error(`refPrice must be finite: ${refPrice}`);
    }
    if (!Number.isFinite(inventorySkew)) {
        throw new Error(`inventorySkew must be finite: ${inventorySkew}`);
    }
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask >= 1 || bid >= ask) {
        throw new Error(`bid and ask must be ordered normalized prices: bid=${bid}, ask=${ask}`);
    }

    const bookMid = midPrice(book);
    const bidEnd = Math.min(refPrice, bookMid);
    const askEnd = Math.max(refPrice, bookMid);
    const bidStart = bid * PROTOCOL_PRICE_SCALE;
    const askStart = ask * PROTOCOL_PRICE_SCALE;
    const bestAsk = book.asks[0]?.price ?? null;
    const bestBid = book.bids[0]?.price ?? null;
    const bidPrices = new Set<number>();
    const askPrices = new Set<number>();

    for (let i = 0; i < CFG.QUOTE_SLOTS_COUNT; i++) {
        const fraction = CFG.QUOTE_SLOTS_COUNT === 1
            ? 0
            : i / (CFG.QUOTE_SLOTS_COUNT - 1);
        const bidPrice = roundToTick(
            bidStart + (bidEnd - bidStart) * fraction,
            "buy",
        );
        const askPrice = roundToTick(
            askStart + (askEnd - askStart) * fraction,
            "sell",
        );

        if (
            bidPrice >= CFG.HARD_MIN_PRICE &&
            bidPrice <= CFG.HARD_MAX_PRICE &&
            bidPrice >= PROTOCOL_MIN_PRICE &&
            bidPrice <= PROTOCOL_MAX_PRICE &&
            (bestAsk == null || bidPrice < bestAsk)
        ) {
            bidPrices.add(bidPrice);
        }
        if (
            askPrice >= CFG.HARD_MIN_PRICE &&
            askPrice <= CFG.HARD_MAX_PRICE &&
            askPrice >= PROTOCOL_MIN_PRICE &&
            askPrice <= PROTOCOL_MAX_PRICE &&
            (bestBid == null || askPrice > bestBid)
        ) {
            askPrices.add(askPrice);
        }
    }

    return {
        bids: [...bidPrices].sort((a, b) => b - a),
        asks: [...askPrices].sort((a, b) => a - b),
    };
}

export function buildTargetSizes(): { bidSizes: number[]; askSizes: number[] } {
    const base0 = randBetween(CFG.QUOTE_BASE_SIZE_MIN, CFG.QUOTE_BASE_SIZE_MAX);
    const sizes: number[] = [];
    let s = base0;
    for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
        const varMul = randBetween(CFG.VARIABILITY_MIN, CFG.VARIABILITY_MAX);
        sizes.push(Math.floor(Math.max(0, s * varMul)));
        s *= CFG.DEPTH_GROWTH;
    }
    return { bidSizes: sizes.slice(), askSizes: sizes.slice() };
}

// ---- solvency/inventory checks ----

export function availableCollateral(): number {
    const reserveLimitedCollateral = Math.max(
        0,
        STATE.baseBal - CFG.BASE_RESERVE_MIN,
    );
    const percentageLimitedCollateral =
        Math.max(0, STATE.baseBal) * CFG.MAX_CAPITAL_EXPOSURE_PERCENT / 100;

    return Math.min(
        reserveLimitedCollateral,
        percentageLimitedCollateral,
    );
}

export function canPlaceOrder(isBuy: boolean, size: number, price: number, collateral?: number): boolean {
    if(isBuy) {
        return canPlaceBid(size, price, collateral);
    } else {
        return canPlaceAsk(size, price, collateral);
    }
}

export function canPlaceAsk(size: number, price: number, collateral?: number): boolean {
    const _collateral = collateral ?? availableCollateral();
    console.log("availableCollateral():", availableCollateral(), "collateral:", collateral, " size:", size, "price:", price, " =>")
    return protocolNotional(size, 1_000_000 - price) <= _collateral;
}

export function canPlaceBid(size: number, price: number, collateral?: number): boolean {
    const _collateral = collateral ?? availableCollateral();
    console.log("availableCollateral():", availableCollateral(), "collateral:", collateral, "size:", size, "price:", price, " =>")
    return protocolNotional(size, price) <= _collateral;
}

export function canAggressBuy(qty: number, estPrice: number): boolean {
    if (qty < PROTOCOL_MIN_SIZE) return false;
    const value = protocolNotional(qty, estPrice);
    if (value > availableCollateral()) return false;
    if (STATE.invBase + qty > CFG.INV_MAX_ABS) return false;
    return true;
}

export function canAggressSell(qty: number, estPrice: number): boolean {
    if (qty < PROTOCOL_MIN_SIZE) return false;
    const value = protocolNotional(qty, 1_000_000 - estPrice);
    if (value > availableCollateral()) return false;
    if (STATE.invBase - qty < -CFG.INV_MAX_ABS) return false;
    return true;
}

export function capOrderSizeByMargin(
    isBuy: boolean,
    size: number,
    price: number,
    collateral: number = availableCollateral(),
): number {
    if (!Number.isFinite(size) || size <= 0) return 0;

    // Unit-level planner callers may provide collateral without initializing
    // the runtime balance. In the live bot STATE.baseBal is refreshed first;
    // the fallback keeps the planner deterministic for isolated callers.
    const balance = STATE.baseBal > 0 ? STATE.baseBal : collateral;
    const marginBudget = Math.floor(Math.min(
        Math.max(0, collateral),
        Math.max(0, balance) * CFG.MAX_ORDER_MARGIN_PERCENT / 100,
    ));
    if (marginBudget <= 0) return 0;

    const maxSize = maxSizeForMargin(
        isBuy ? "buy" : "sell",
        price,
        marginBudget,
    );
    const maxSizeNumber = protocolValueToSafeNumber(maxSize, "maximum order size");
    return roundDownToOrderLot(Math.min(size, maxSizeNumber));
}

// ---- direction choice ----

export function computePBuy(mid: number): number {
    const range = Math.max(1e-9, CFG.SOFT_MAX_PRICE - CFG.CENTER_PRICE);
    const x = (mid - CFG.CENTER_PRICE) / range;
    let pBuy = 0.5 - 0.5 * tanh(CFG.MEANREV_K * clamp(x, -2, 2));

    const invNorm = clamp((STATE.invBase - CFG.INV_TARGET) / Math.max(1e-9, CFG.INV_MAX_ABS), -1, 1);
    pBuy = pBuy - CFG.INV_SKEW_STRENGTH * invNorm * 0.5;

    return clamp(pBuy, 0.02, 0.98);
}

export function chooseAggressionSide(mid: number): Side {
    const range = Math.max(1e-9, CFG.SOFT_MAX_PRICE - CFG.CENTER_PRICE);
    const x = (mid - CFG.CENTER_PRICE) / range;

    const outward: Side = x >= 0 ? "buy" : "sell";
    if (Math.random() < CFG.EXTREME_PUSH_PROB) return outward;

    const pBuy = computePBuy(mid);
    return Math.random() < pBuy ? "buy" : "sell";
}

export function chooseFairValueAggressionSide(book: BookSnapshot, reference: number): Side | null {
    if (!hasFreshFairValue()) return chooseAggressionSide(reference);

    // This chooses to cross the spread to buy if reference > ask by minEdge, and sell if reference < bid by minEdge.
    const { bid, ask } = bestBidAsk(book);
    const minEdge = CFG.FAIR_VALUE_MIN_EDGE_TICKS * CFG.TICK_SIZE;
    const buyEdge = ask == null ? Number.NEGATIVE_INFINITY : reference - ask;
    const sellEdge = bid == null ? Number.NEGATIVE_INFINITY : bid - reference;
    const bestEdge = Math.max(buyEdge, sellEdge);

    if (bestEdge < minEdge) return null;
    return buyEdge >= sellEdge ? "buy" : "sell";
}

function roundToNearestTick(price: number): number {
    const tick = CFG.TICK_SIZE;
    if (tick <= 0) return Math.round(price);
    return Math.round(price / tick) * tick;
}
