import { CFG } from "./config.js";
import { apiCancelOrder, apiGetBook, apiGetPending, apiSendOrder } from "./api.js";
import { STATE } from "./state.js";
import { jitter, log, nowMs, sleep, warn, clamp, roundToTick } from "./utils.js";
import {
    midPrice,
    buildTargetLadderPrices,
    buildTargetSizes,
    nearestOrderAtPrice,
    canPlaceBid,
    canPlaceAsk,
    chooseAggressionSide,
    depthToWipe,
    canAggressBuy,
    canAggressSell,
} from "./strategy.js";
import { Wallet } from "ethers";

export async function loopBookRefresh() {
    while (true) {
        try {
            const book = await apiGetBook();
            //console.log("book refresh:", book);//.asks.length, book.bids.length);
            STATE.book = book;
            const mid = midPrice(book);
            console.log("mid:", mid);
            STATE.lastMid = mid;
        } catch (e: any) {
            warn("book refresh error:", e?.message ?? e);
        }
        await sleep(CFG.BOOK_REFRESH_MS);
    }
}

export async function loopPendingRefresh() {
    while (true) {
        try {
            const pendingResp = await apiGetPending();
            console.log("pending refresh:", pendingResp);
            const next = new Map<string, any>();
            for (const o of pendingResp.orders ?? []) {
                const order = {
                    id: String(o.id),
                    side: o.side,
                    price: Number(o.price),
                    size: Number(o.size),
                    ts: o.ts ? Number(o.ts) : undefined,
                };
                console.log("order:", order);
                next.set(order.id, order);
                if (!STATE.localOrderTs.has(order.id)) STATE.localOrderTs.set(order.id, nowMs());
            }

            for (const id of STATE.pending.keys()) {
                if (!next.has(id)) STATE.localOrderTs.delete(id);
            }
            STATE.pending = next;/**/
        } catch (e: any) {
            warn("pending refresh error:", e?.message ?? e);
        }
        await sleep(CFG.PENDING_REFRESH_MS);
    }
}

export async function loopQuoteMaintenance(wallet: Wallet) {
    while (true) {
        await sleep(jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS));
        const book = STATE.book;
        if (!book) continue;

        console.log("quote maintenance:", book);
        const mid = midPrice(book);
        const { bids: targetBidPrices, asks: targetAskPrices } = buildTargetLadderPrices(mid);
        const { bidSizes, askSizes } = buildTargetSizes();

        console.log("targetBids:", targetBidPrices);
        console.log("targetAsks:", targetAskPrices);
        console.log("bidSizes:", bidSizes);
        console.log("askSizes:", askSizes);
        // inventory skew: long => bias asks; short => bias bids
        const invNorm = clamp((STATE.invBase - CFG.INV_TARGET) / Math.max(1e-9, CFG.INV_MAX_ABS), -1, 1);
        console.log("invNorm:", invNorm);
        const askSkewMul = 1 + 0.30 * Math.max(0, invNorm);
        const bidSkewMul = 1 + 0.30 * Math.max(0, -invNorm);
        console.log("askSkewMul:", askSkewMul);
        console.log("bidSkewMul:", bidSkewMul);

        for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
            console.log("========bidLevel[i]:", i);
            const price = targetBidPrices[i];
            console.log("price:", price);
            const _nearestOrderAtPrice = nearestOrderAtPrice(STATE.pending, "buy", price);
            console.log("_nearestOrderAtPrice:", _nearestOrderAtPrice);
            if (_nearestOrderAtPrice) continue;
            const size = bidSizes[i] * bidSkewMul;
            console.log("size:", size);
            const _canPlaceBid = canPlaceBid(size, price);
            console.log("canPlaceBid:", _canPlaceBid);
            if (!_canPlaceBid) continue;
            console.log("here");
            try {
                await apiSendOrder(wallet, { side: "buy", price, size });
                log("placed bid", { price, size });
                if (CFG.USE_LOCAL_LEDGER) STATE.quoteBal -= Math.floor(size * price / 1000000);
            } catch (e: any) {
                warn("place bid error:", e?.message ?? e);
            }/**/
        }

        for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
            const price = targetAskPrices[i];
            if (nearestOrderAtPrice(STATE.pending, "sell", price)) continue;
            const size = askSizes[i] * askSkewMul;
            if (!canPlaceAsk(size)) continue;

            try {
                await apiSendOrder(wallet, { side: "sell", price, size });
                log("placed ask", { price, size });
                if (CFG.USE_LOCAL_LEDGER) STATE.baseBal -= Math.floor((1000000 - price) * size / 1000000);
            } catch (e: any) {
                warn("place ask error:", e?.message ?? e);
            }
        }/**/
    }
}

export async function loopCancelRebalance() {
    while (true) {
        await sleep(jitter(CFG.CANCEL_LOOP_MS, CFG.CANCEL_JITTER_MS));
        const book = STATE.book;
        if (!book) continue;

        const cutoff = nowMs() - CFG.STALE_SECONDS * 1000;
        const toCancel: any[] = [];

        for (const o of STATE.pending.values()) {
            const ts = o.ts ?? STATE.localOrderTs.get(o.id) ?? nowMs();
            if (ts < cutoff) toCancel.push(o);
        }

        const pendingArr = Array.from(STATE.pending.values());
        if (pendingArr.length > CFG.MAX_PENDING_ORDERS) {
            const excess = pendingArr.length - CFG.MAX_PENDING_ORDERS;
            const mid = midPrice(book);
            const sorted = pendingArr
                .slice()
                .sort((a, b) => Math.abs(b.price - mid) - Math.abs(a.price - mid));
            for (let i = 0; i < excess; i++) toCancel.push(sorted[i]);
        }

        const uniq = new Map<string, any>();
        for (const o of toCancel) uniq.set(o.id, o);
        const batch = Array.from(uniq.values()).slice(0, CFG.CANCEL_BATCH_MAX);

        for (const o of batch) {
            try {
                await apiCancelOrder(o.id);
                log("canceled", { id: o.id, side: o.side, price: o.price, size: o.size });
                if (CFG.USE_LOCAL_LEDGER) {
                    if (o.side === "buy") STATE.quoteBal += o.size * o.price;
                    else STATE.baseBal += o.size;
                }
            } catch (e: any) {
                warn("cancel error:", e?.message ?? e);
            }
        }
    }
}

export async function loopAggression(wallet: Wallet) {
    while (true) {
        await sleep(jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS));
        const book = STATE.book;
        if (!book) continue;

        const mid = midPrice(book);
        let side = chooseAggressionSide(mid);

        if (side === "buy" && book.asks.length < CFG.WIPE_LEVELS) continue;
        if (side === "sell" && book.bids.length < CFG.WIPE_LEVELS) continue;

        const reqBuy = depthToWipe(book, "buy", CFG.WIPE_LEVELS).qty;
        const reqSell = depthToWipe(book, "sell", CFG.WIPE_LEVELS).qty;

        let tradeQty = (side === "buy" ? reqBuy : reqSell) * (1 + CFG.SLIP_BUFFER);
        tradeQty = Math.min(tradeQty, CFG.MAX_AGGRESS_QTY);

        const feasibleChosen = side === "buy"
            ? canAggressBuy(tradeQty, mid)
            : canAggressSell(tradeQty);

        if (!feasibleChosen) {
            const other = side === "buy" ? "sell" : "buy";
            const otherReq = other === "buy" ? reqBuy : reqSell;
            let otherQty = Math.min(otherReq * (1 + CFG.SLIP_BUFFER), CFG.MAX_AGGRESS_QTY);

            const feasibleOther = other === "buy"
                ? canAggressBuy(otherQty, mid)
                : canAggressSell(otherQty);

            if (!feasibleOther) {
                log("aggression skipped (not feasible)", {
                    mid, chosen: side, qty: tradeQty, baseBal: STATE.baseBal, quoteBal: STATE.quoteBal, inv: STATE.invBase,
                });
                continue;
            }
            side = other;
            tradeQty = otherQty;
        }

        const aggressivePrice =
            side === "buy"
                ? clamp(roundToTick(mid + 10 * CFG.TICK_SIZE, "sell"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE)
                : clamp(roundToTick(mid - 10 * CFG.TICK_SIZE, "buy"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE);

        try {
            await apiSendOrder(wallet, { side, price: aggressivePrice, size: tradeQty });
            log("aggressed", { side, qty: tradeQty, price: aggressivePrice, mid });

            // local-ledger assumption: fills completely
            if (CFG.USE_LOCAL_LEDGER) {
                if (side === "buy") {
                    const cost = tradeQty * aggressivePrice;
                    STATE.quoteBal -= cost;
                    STATE.baseBal += tradeQty;
                    STATE.invBase += tradeQty;
                } else {
                    STATE.baseBal -= tradeQty;
                    STATE.quoteBal += tradeQty * aggressivePrice;
                    STATE.invBase -= tradeQty;
                }
            }
        } catch (e: any) {
            warn("aggression error:", e?.message ?? e);
        }
    }
}
