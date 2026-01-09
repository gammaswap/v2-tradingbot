import { CFG, type Side } from "../config/config.js";
import type { BookSnapshot, PendingOrder } from "../utils/types.js";
import { STATE } from "./state.js";
import { clamp, randBetween, roundToTick, tanh } from "../utils/utils.js";

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

export function depthToWipe(book: BookSnapshot, side: Side, levels: number): { qty: number; notional: number } {
    const arr = side === "buy" ? book.asks : book.bids;
    let qty = 0;
    let notional = 0;
    for (let i = 0; i < Math.min(levels, arr.length); i++) {
        qty += arr[i].size;
        notional += arr[i].size * arr[i].price;
    }
    return { qty, notional };
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

export function availableBase(): number {
    return Math.max(0, STATE.baseBal - CFG.BASE_RESERVE_MIN);
}

export function availableQuote(): number {
    return Math.max(0, STATE.quoteBal - CFG.QUOTE_RESERVE_MIN);
}

export function canPlaceAsk(size: number, price: number): boolean {
    console.log("availableQuote():", availableQuote(), "size:", size, "price:", price, " =>")
    return Math.floor(size * (1000000 - price) / 1000000) <= availableQuote();
}

export function canPlaceBid(size: number, price: number): boolean {
    console.log("availableQuote():", availableQuote(), "size:", size, "price:", price, " =>")
    return Math.floor(size * price / 1000000) <= availableQuote();
}

export function canAggressBuy(qty: number, estPrice: number): boolean {
    if (qty * estPrice > availableQuote()) return false;
    if (STATE.invBase + qty > CFG.INV_MAX_ABS) return false;
    return true;
}

export function canAggressSell(qty: number): boolean {
    if (qty > availableBase()) return false;
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
