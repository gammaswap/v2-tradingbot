import { CFG } from "../config/config.js";
import {
    apiCancelOrder,
    apiClaim,
    apiGetBalance,
    apiGetBook,
    apiGetPending,
    apiGetPosition,
    apiLastResolutionPrice,
    apiSendOrder
} from "../api/api.js";
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
import { Wallet, ZeroHash } from "ethers";
import { getPositionBalance } from "../chain/blockchain.js";

export async function hasPendingOrders() {
    const resp = await apiGetBalance();
    console.log("cleanUpAllOrders:cancel all orders >> pending", resp.pending);
    const hasPendingBalance = resp.pending >= CFG.DUST_BALANCE;
    await sleep(1000 * 2);
    return hasPendingBalance;
}

export async function cleanUpAllOrders(wallet: Wallet) {
    let done = false;
    let tryCount = 0;
    while(!done) {
        if(await hasPendingOrders()) {
            console.log("cleanUpAllOrders:cancel all orders >> tryCount:", tryCount);
            await cancelAllOrders(wallet);
            tryCount++;
        } else {
            console.log("cleanUpAllOrders:done");
            done = true;
        }
        if(tryCount >= 10) {
            console.log("cleanUpAllOrders:cancel all orders >> max tryCount reached");
            done = true;
        }
    }
}

export async function cancelAllOrders(wallet: Wallet) {
    let epoch = Number(STATE.epoch);
    let done = false;
    while(!done && epoch > 0n) {
        console.log("cancelAllOrders:epoch:", epoch);
        // look for pending orders
        const pending = await apiGetPending(CFG.USER_ADDRESS, epoch);
        if(pending.buys.length > 0 || pending.sells.length > 0) {
            // has pending orders, send cancel all
            console.log("cancelAllOrders:cancel all orders >> pending.buys:", pending.buys.length, "pending.sells:", pending.sells.length, "epoch:", epoch);
            await apiCancelOrder(wallet, epoch, ZeroHash);
            epoch--;
        } else {
            console.log("cancelAllOrders:skipping: epoch:", epoch);
            epoch--;
        }
        await sleep(1000 * 3);

        const resp = await apiGetBalance();
        if(resp.pending < CFG.DUST_BALANCE) {
            warn("Error: Pending balance > 0, pending:", resp.pending);
            done = true;
            return;
        }

        await sleep(1000 * 3);
    }
}

export async function getCurrentEpoch() : Promise<bigint> {
    let epoch = 0n;
    const resolution = await apiLastResolutionPrice();
    if(!resolution.isNull) {
        epoch = BigInt(resolution.epoch) + 1n;
    }
    return epoch;
}

export async function runAssetEpochCheck(wallet: Wallet) {
    console.log("=============runAssetEpochCheck:start",(new Date()).toUTCString(),"============================");
    const epoch = await getCurrentEpoch();
    if(epoch != STATE.epoch) {
        let pos;
        try {
            pos = await apiGetPosition(Number(STATE.epoch));
        } catch(e: any) {
           console.log("position check error:", e?.message ?? e);
        }
        console.log("asset epoch check >> epoch:", epoch, "STATE.epoch:", STATE.epoch, "pos:", pos);
        try{
            if(pos && pos.size > 0n) {
                await apiClaim(wallet, Number(STATE.epoch));
            }
        } catch(e: any) {
            console.log("claim error:", e?.message ?? e);
        }
        if(await hasPendingOrders()) {
            await cancelAllOrders(wallet);
            console.log("cancelled all orders, return false");
            return false;
        } else {
            // just move to next period
            STATE.epoch = epoch;
            console.log("asset epoch changed:", STATE.epoch);
        }
    }
    console.log("=============runAssetEpochCheck:end",(new Date()).toUTCString(),"============================");
    return true;
}

export async function runBookRefresh() {
    console.log("=============runBookRefresh:start",(new Date()).toUTCString(),"============================");
    try {
        const book = await apiGetBook(Number(STATE.epoch));
        STATE.book = book;
        STATE.lastMid = midPrice(book);
        console.log("book refreshed:", STATE.lastMid, "bids:", book.bids.length, "asks:", book.asks.length, "total:", book.asks.length + book.bids.length, "time:", new Date().toUTCString());
    } catch (e: any) {
        warn("book refresh error:", e?.message ?? e);
    }
    console.log("=============runBookRefresh:end",(new Date()).toUTCString(),"============================");
    await sleep(CFG.BOOK_REFRESH_MS);
}

export async function runPendingRefresh(wallet: Wallet) {
    console.log("=============runPendingRefresh:start",(new Date()).toUTCString(),"============================");
    try {
        const pendingResp = await apiGetPending(wallet.address, Number(STATE.epoch));
        const next = new Map<string, any>();
        for (const o of pendingResp.buys ?? []) {
            const order = {
                id: String(o.id),
                side: "buy",
                price: Number(o.price),
                size: Number(o.size),
                time: o.time ? Number(o.time) : undefined,
                account: o.account,
                epoch: BigInt(pendingResp.epoch)
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
                account: o.account,
                epoch: BigInt(pendingResp.epoch)
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
    console.log("=============runPendingRefresh:end",(new Date()).toUTCString(),"============================");
    await sleep(CFG.PENDING_REFRESH_MS);
}

export async function runQuoteMaintenance(wallet: Wallet) {
    console.log("=============runQuoteMaintenance:start",(new Date()).toUTCString(),"============================");
    const position = await getPositionBalance(1n, wallet.address);
    STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1)
    const book = STATE.book;
    if (!book) return;

    const epoch = await getCurrentEpoch();
    if(epoch != STATE.epoch) {
        console.log("quote maintenance skipped (epoch mismatch)", { epoch, STATE_epoch: STATE.epoch });
        return;
    }

    const mid = midPrice(book);
    console.log("book >> bids:", book.bids.length, "asks:", book.asks.length," total:", book.asks.length + book.bids.length, "mid:", mid);
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
            await apiSendOrder(wallet, { epoch: Number(STATE.epoch), side: "buy", price, size });
            log("placed bid", { price, size });
            if (CFG.USE_LOCAL_LEDGER) STATE.baseBal -= Math.floor(size * price / 1000000); // USD
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
            await apiSendOrder(wallet, { epoch: Number(STATE.epoch), side: "sell", price, size });
            log("placed ask", { price, size });
            if (CFG.USE_LOCAL_LEDGER) STATE.baseBal -= Math.floor((1000000 - price) * size / 1000000); // Asset
        } catch (e: any) {
            warn("place ask error:", e?.message ?? e);
        }

        const _book = await apiGetBook(Number(STATE.epoch));
        STATE.book = _book;
        STATE.lastMid = midPrice(_book);
        console.log("book refreshed:", STATE.lastMid, "bids:", _book.bids.length, "asks:", _book.asks.length, "total:", _book.asks.length + _book.bids.length);
    }
    console.log("=============runQuoteMaintenance:end",(new Date()).toUTCString(),"============================");
    await sleep(jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS));
}

export async function runCancelRebalance(wallet: Wallet) {
    console.log("=============runCancelRebalance:start",(new Date()).toUTCString(),"============================");
    const book = STATE.book;
    if (!book) return;

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
            await apiCancelOrder(wallet, Number(o.epoch), o.id);
            log("canceled", { id: o.id, side: o.side, price: o.price, size: o.size });
            if (CFG.USE_LOCAL_LEDGER) {
                if (o.side === "buy") STATE.baseBal += Math.floor(Number(o.size) * Number(o.price) / 1000000);
                else STATE.baseBal += Math.floor(Number(o.size) * (1000000 - Number(o.price)) / 1000000);
            }
        } catch (e: any) {
            warn("cancel error:", e?.message ?? e);
        }
    }

    const _book = await apiGetBook(Number(STATE.epoch));
    STATE.book = _book;
    STATE.lastMid = midPrice(_book);
    console.log("book refreshed:", STATE.lastMid, "bids:", _book.bids.length, "asks:", _book.asks.length, "total:", _book.asks.length + _book.bids.length);
    console.log("=============runCancelRebalance:end",(new Date()).toUTCString(),"============================");
    await sleep(jitter(CFG.CANCEL_LOOP_MS, CFG.CANCEL_JITTER_MS));
}

export async function runAggression(wallet: Wallet) {
    const book = STATE.book;
    if (!book) return;

    const currTime = nowMs();
    const tradeDelay = jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);
    const msSinceLastTrade = currTime - STATE.lastTradeTime;
    if(msSinceLastTrade < tradeDelay) {
        console.log("aggression skipped (trade delay)", { msSinceLastTrade, tradeDelay });
        return;
    }
    STATE.lastTradeTime = currTime;

    const epoch = await getCurrentEpoch();
    if(epoch != STATE.epoch) {
        console.log("aggression skipped (epoch mismatch)", { epoch, STATE_epoch: STATE.epoch });
        return;
    }

    console.log("========================runAggression:start",(new Date()).toUTCString(),"==========================");
    const mid = midPrice(book);
    console.log("mid:", mid);
    let side = chooseAggressionSide(mid);
    console.log("side:", side);
    console.log("CFG.WIPE_LEVELS:", CFG.WIPE_LEVELS);
    console.log("asksLen:", book.asks.length, "bidsLen:", book.bids.length);

    if (side === "buy" && book.asks.length < CFG.WIPE_LEVELS) return;
    if (side === "sell" && book.bids.length < CFG.WIPE_LEVELS) return;

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
                mid, chosen: side, qty: tradeQty, baseBal: STATE.baseBal, inv: STATE.invBase,
            });
            return;
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
        await apiSendOrder(wallet, { epoch: Number(STATE.epoch), side, price: aggressivePrice, size: tradeQty });
        log("aggressed", { side, qty: tradeQty, price: aggressivePrice, mid });

        //STATE.baseBal = Number(await getLedgerBalance(wallet.address));
        const resp = await apiGetBalance();
        STATE.baseBal = Number(resp.balance);
        if (CFG.USE_LOCAL_LEDGER) {
            if (side === "buy") {
                STATE.invBase += tradeQty;
            } else {
                STATE.invBase -= tradeQty;
            }
        }
    } catch (e: any) {
        warn("aggression error:", e?.message ?? e);
    }

    const _book = await apiGetBook(Number(STATE.epoch));
    STATE.book = _book;
    STATE.lastMid = midPrice(_book);
    console.log("book refreshed:", STATE.lastMid, "bids:", _book.bids.length, "asks:", _book.asks.length, "total:", _book.asks.length + _book.bids.length);
    console.log("========================runAggression:end",(new Date()).toUTCString(),"==========================");
}
