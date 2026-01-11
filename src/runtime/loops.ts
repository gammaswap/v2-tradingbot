import { CFG } from "../config/config.js";
import { apiCancelOrder, apiGetBook, apiGetPending, apiSendOrder } from "../api/api.js";
import { STATE } from "./state.js";
import { jitter, log, nowMs, sleep, warn, clamp, roundToTick } from "../utils/utils.js";
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
            console.log("book refresh >> bids:", book.bids.length, "asks:", book.asks.length," total:", book.asks.length + book.bids.length);
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

export async function loopPendingRefresh(wallet: Wallet) {
    while (true) {
        try {
            const pendingResp = await apiGetPending(wallet.address);
            console.log("pending refresh:", pendingResp.buys.length + pendingResp.sells.length, "orders");
            const next = new Map<string, any>();
            for (const o of pendingResp.buys ?? []) {
                const order = {
                    id: String(o.id),
                    side: "buy",
                    price: Number(o.price),
                    size: Number(o.size),
                    time: o.time ? Number(o.time) : undefined,
                    account: o.account
                };
                next.set(order.id, order);
                if (!STATE.localOrderTs.has(order.id)) STATE.localOrderTs.set(order.id, nowMs());
            }
            for (const o of pendingResp.sells ?? []) {
                const order = {
                    id: String(o.id),
                    side: "sell",
                    price: Number(o.price),
                    size: Number(o.size),
                    time: o.time ? Number(o.time) : undefined,
                    account: o.account
                };
                next.set(order.id, order);
                if (!STATE.localOrderTs.has(order.id)) STATE.localOrderTs.set(order.id, nowMs());
            }

            for (const id of STATE.pending.keys()) {
                if (!next.has(id)) STATE.localOrderTs.delete(id);
            }
            STATE.pending = next;
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
            const price = targetBidPrices[i];
            const _nearestOrderAtPrice = nearestOrderAtPrice(STATE.pending, "buy", price);
            if (_nearestOrderAtPrice) continue;
            const size = bidSizes[i] * bidSkewMul;
            const _canPlaceBid = canPlaceBid(size, price);
            if (!_canPlaceBid) continue;
            try {
                await apiSendOrder(wallet, { side: "buy", price, size });
                log("placed bid", { price, size });
                if (CFG.USE_LOCAL_LEDGER) STATE.quoteBal -= Math.floor(size * price / 1000000); // USD
            } catch (e: any) {
                warn("place bid error:", e?.message ?? e);
            }
        }

        for (let i = 0; i < CFG.LEVELS_PER_SIDE; i++) {
            const price = targetAskPrices[i];
            const _nearestOrderAtPrice = nearestOrderAtPrice(STATE.pending, "sell", price);
            if (_nearestOrderAtPrice) continue;
            const size = askSizes[i] * askSkewMul;
            const _canPlaceAsk = canPlaceAsk(size, price);
            if (!_canPlaceAsk) continue;

            try {
                await apiSendOrder(wallet, { side: "sell", price, size });
                log("placed ask", { price, size });
                if (CFG.USE_LOCAL_LEDGER) STATE.baseBal -= Math.floor((1000000 - price) * size / 1000000); // Asset
            } catch (e: any) {
                warn("place ask error:", e?.message ?? e);
            }
        }
    }
}

export async function loopCancelRebalance(wallet: Wallet) {
    while (true) {
        await sleep(jitter(CFG.CANCEL_LOOP_MS, CFG.CANCEL_JITTER_MS));
        const book = STATE.book;
        if (!book) continue;

        const cutoff = nowMs() - CFG.STALE_SECONDS * 1000;
        console.log("cancel stale orders cutoff:", cutoff);
        const toCancel: any[] = [];

        for (const o of STATE.pending.values()) {
            const ts = o.time ?? STATE.localOrderTs.get(o.id) ?? nowMs();
            if (ts < cutoff) toCancel.push(o);
        }
        console.log("canceling:", toCancel.length, "stale orders");

        const pendingArr = Array.from(STATE.pending.values());
        if (pendingArr.length > CFG.MAX_PENDING_ORDERS) {
            const excess = pendingArr.length - CFG.MAX_PENDING_ORDERS;
            const mid = midPrice(book);
            const sorted = pendingArr
                .slice()
                .sort((a, b) => Math.abs(b.price - mid) - Math.abs(a.price - mid));
            for (let i = 0; i < excess; i++) toCancel.push(sorted[i]);
        }
        console.log("canceling:", toCancel.length, "excess orders");

        const uniq = new Map<string, any>();
        for (const o of toCancel) uniq.set(o.id, o);
        const batch = Array.from(uniq.values()).slice(0, CFG.CANCEL_BATCH_MAX);

        console.log("canceling:", batch.length, "total orders");
        for (const o of batch) {
            try {
                await apiCancelOrder(wallet, o.id);
                log("canceled", { id: o.id, side: o.side, price: o.price, size: o.size });
                if (CFG.USE_LOCAL_LEDGER) {
                    if (o.side === "buy") STATE.quoteBal += Math.floor(Number(o.size) * Number(o.price) / 1000000);
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

        console.log("========================loopAggression:start==========================");
        const mid = midPrice(book);
        console.log("mid:", mid);
        let side = chooseAggressionSide(mid);
        console.log("side:", side);
        console.log("CFG.WIPE_LEVELS:", CFG.WIPE_LEVELS);
        console.log("book.asks.length:", book.asks.length);
        console.log("book.bids.length:", book.bids.length);

        if (side === "buy" && book.asks.length < CFG.WIPE_LEVELS) continue;
        if (side === "sell" && book.bids.length < CFG.WIPE_LEVELS) continue;

        const reqBuy = depthToWipe(book, "buy", CFG.WIPE_LEVELS).qty;
        const reqSell = depthToWipe(book, "sell", CFG.WIPE_LEVELS).qty;
        console.log("reqBuy:", reqBuy);
        console.log("reqSell:", reqSell);
        let tradeQty = (side === "buy" ? reqBuy : reqSell) * (1 + CFG.SLIP_BUFFER);
        console.log("tradeQty1:", tradeQty);
        tradeQty = Math.floor(Math.min(tradeQty, CFG.MAX_AGGRESS_QTY));
        console.log("tradeQty2:", tradeQty);

        const feasibleChosen = side === "buy"
            ? canAggressBuy(tradeQty, mid)
            : canAggressSell(tradeQty, mid);
        console.log("feasibleChosen:", feasibleChosen);

        if (!feasibleChosen) {
            const other = side === "buy" ? "sell" : "buy";
            console.log("other:", other);
            const otherReq = other === "buy" ? reqBuy : reqSell;
            console.log("otherReq:", otherReq);
            let otherQty = Math.min(otherReq * (1 + CFG.SLIP_BUFFER), CFG.MAX_AGGRESS_QTY);
            console.log("otherQty:", otherQty);

            const feasibleOther = other === "buy"
                ? canAggressBuy(otherQty, mid)
                : canAggressSell(otherQty, mid);
            console.log("feasibleOther:", feasibleOther);

            if (!feasibleOther) {
                log("aggression skipped (not feasible)", {
                    mid, chosen: side, qty: tradeQty, baseBal: STATE.baseBal, quoteBal: STATE.quoteBal, inv: STATE.invBase,
                });
                continue;
            }
            side = other;
            tradeQty = otherQty;
            console.log("side:", side);
            console.log("tradeQty:", tradeQty);
        }

        console.log("TICK_SIZE:", CFG.TICK_SIZE);
        const aggressivePrice =
            side === "buy"
                ? clamp(roundToTick(mid + 10 * CFG.TICK_SIZE, "sell"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE)
                : clamp(roundToTick(mid - 10 * CFG.TICK_SIZE, "buy"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE);

        console.log("aggressivePrice:", aggressivePrice, "side:", side, "qty:", tradeQty, "mid:", mid);
        try {
            await apiSendOrder(wallet, { side, price: aggressivePrice, size: tradeQty });
            log("aggressed", { side, qty: tradeQty, price: aggressivePrice, mid });

            // local-ledger assumption: fills completely
            if (CFG.USE_LOCAL_LEDGER) {
                if (side === "buy") {
                    STATE.quoteBal -= Math.floor(tradeQty * aggressivePrice / 1000000); // USD
                    STATE.baseBal += Math.floor(tradeQty * (1000000 - aggressivePrice) / 1000000); // Asset
                    STATE.invBase += tradeQty;
                } else {
                    STATE.baseBal -= Math.floor(tradeQty * (1000000 - aggressivePrice) / 1000000); // Asset
                    STATE.quoteBal += Math.floor(tradeQty * aggressivePrice / 1000000); // USD
                    STATE.invBase -= tradeQty;
                }
            }
        } catch (e: any) {
            warn("aggression error:", e?.message ?? e);
        }/**/
        console.log("========================loopAggression:end==========================");
    }
}
