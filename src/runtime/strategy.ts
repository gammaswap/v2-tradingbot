import { CFG, type Side } from "../config/config.js";
import type { BookSnapshot, PendingOrder } from "../utils/types.js";
import { STATE } from "./state.js";
import { clamp, nowMs, randBetween, roundToTick, tanh } from "../utils/utils.js";
import { protocolNotional, protocolNotionalBigInt, protocolValueToSafeNumber } from "../utils/protocolMath.js";

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

export function buildTargetLadderPrices(mid: number): { bids: number[]; asks: number[] } {
    console.log("===============buildTargetLadderPrices:start==================");
    const bids: number[] = [];
    const asks: number[] = [];
    let spacing = CFG.LEVEL_SPACING_NEAR;
    console.log("mid:", mid);
    console.log("spacing:", spacing);

    for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
        console.log("level:i:",i,"spacing:",spacing)
        const bidP = clamp(roundToTick(mid - spacing, "buy"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE);
        const askP = clamp(roundToTick(mid + spacing, "sell"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE);
        bids.push(bidP);
        asks.push(askP);
        spacing *= CFG.LEVEL_SPACING_GROWTH;
    }

    console.log("===============buildTargetLadderPrices:end==================");
    return { bids, asks };
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
    return Math.max(0, STATE.baseBal - CFG.BASE_RESERVE_MIN);
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
    const value = protocolNotional(qty, estPrice);
    if (value > availableCollateral()) return false;
    if (STATE.invBase + qty > CFG.INV_MAX_ABS) return false;
    return true;
}

export function canAggressSell(qty: number, estPrice: number): boolean {
    const value = protocolNotional(qty, 1_000_000 - estPrice);
    if (value > availableCollateral()) return false;
    if (STATE.invBase - qty < -CFG.INV_MAX_ABS) return false;
    return true;
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
