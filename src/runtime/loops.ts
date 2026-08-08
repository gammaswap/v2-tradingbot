import { CFG } from "../config/config.js";
import {
    apiCancelOrder,
    apiCancelReplaceOrder,
    apiClaim,
    apiGetBalance,
    apiGetBook,
    apiGetPending,
    apiGetPosition,
    apiLastResolutionPrice,
    apiSendOrder
} from "../api/api.js";
import { STATE } from "./state.js";
import { jitter, log, nowMs, sleep, warn, clamp, roundToTick, roundToLot, getOrderKey } from "../utils/utils.js";
import {
    midPrice,
    referencePrice,
    shouldPauseForFairValue,
    buildTargetLadderPrices,
    buildTargetSizes,
    nearestOrderAtPrice,
    canPlaceBid,
    canPlaceAsk,
    chooseFairValueAggressionSide,
    depthToWipe,
    canAggressBuy,
    canAggressSell,
    availableCollateral,
    canPlaceOrder,
} from "./strategy.js";
import { Wallet, ZeroHash } from "ethers";
import { getAssetById, getPositionBalance } from "../chain/blockchain.js";
import { updateFairValueFromOracle } from "./fairValue.js";
import { OrderKey, PendingOrder, CancelReplaceInstruction, NewOrderInstruction } from "../utils/types.js";
import { TimeInForce } from "@gammaswap/v2-exchange-sdk";

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
    console.log("==============cancelAllOrders:start", epoch,"========================");
    while(!done && epoch >= 0n) {
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
    console.log("==============cancelAllOrders:end", epoch,"========================");
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
            try {
                STATE.asset = await getAssetById(BigInt(CFG.ASSET_ID));
                if (STATE.oracle.price != null) updateFairValueFromOracle(STATE.oracle.price, STATE.oracle.ts);
                console.log("asset refreshed:", STATE.asset);
            } catch(e: any) {
                console.log("asset refresh error:", e?.message ?? e);
            }
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
        STATE.pendingBuys.clear();
        STATE.pendingSells.clear();
        for (const o of pendingResp.buys ?? []) {
            const order = {
                id: String(o.id),
                side: "buy",
                price: Number(o.price),
                size: Number(o.size),
                time: Number(o.time),
                account: o.account,
                epoch: BigInt(pendingResp.epoch)
            } as PendingOrder;
            const orderKey = getOrderKey(order);
            if(!STATE.pendingBuys.has(orderKey)) STATE.pendingBuys.set(orderKey, order)
            next.set(order.id, order);
        }
        for (const o of pendingResp.sells ?? []) {
            const order = {
                id: String(o.id),
                side: "sell",
                price: Number(o.price),
                size: Number(o.size),
                time: Number(o.time),
                account: o.account,
                epoch: BigInt(pendingResp.epoch)
            } as PendingOrder;
            const orderKey = getOrderKey(order);
            if(!STATE.pendingSells.has(orderKey)) STATE.pendingSells.set(orderKey, order)
            next.set(order.id, order);
        }
        STATE.pending = next;
    } catch (e: any) {
        warn("pending refresh error:", e?.message ?? e);
    }
    console.log("=============runPendingRefresh:end",(new Date()).toUTCString(),"============================");
    await sleep(CFG.PENDING_REFRESH_MS);
}

function shouldCancelReplace(o: PendingOrder, newPrice: number, newSize: number, tolTicks: number = 1) : boolean {
    const tol = CFG.TICK_SIZE * tolTicks + 1;//1e-12;
    if (Math.abs(o.price - newPrice) <= tol) {
        return false;
    }

    const tolSize = 10000 * 1000; // 10 USD = $0.01 x 1000
    if (Math.abs(o.size - newSize) <= tolSize) {
        return false;
    }

    return true;
}

function prepareOrders(oldOrders: PendingOrder[], newPrices: number[], newSizes: number[], skewMul: number, isBuy: boolean) : {
    cancelReplaces: CancelReplaceInstruction[],
    cancels: string[],
    newOrders: NewOrderInstruction[]
} {
    const minLength = Math.min(oldOrders.length, newPrices.length);
    const cancelReplaces: any[] = [];
    const cancels: any[] = [];
    const newOrders: any[] = [];
    let collateral = availableCollateral();
    for(let i = 0; i < minLength; i++) {
        const oldOrder = oldOrders[i];
        const price = newPrices[i]
        const size = roundToLot(newSizes[i] * skewMul);
        const oldMarginPrice =  isBuy ? oldOrder.price : 1000000 - oldOrder.price;
        const newMarginPrice = isBuy ? price : 1000000 - price;
        const oldMargin = Math.floor(oldOrder.size * oldMarginPrice / 1000000);
        const newMargin = Math.floor(size * newMarginPrice / 1000000);
        const marginChange = newMargin - oldMargin;
        if(marginChange <= 0) { // no risk change or decreasing risk
            if(shouldCancelReplace(oldOrder, price, size)) {
                // create new cancel replace order
                cancelReplaces.push({
                    price: price,
                    size: size,
                    side: oldOrder.side,
                    cancelId: oldOrder.id
                })
                collateral += marginChange;
            }
        } else if(marginChange > 0) { // increasing risk
            let _canPlaceOrder = canPlaceOrder(isBuy, size, price, collateral + oldMargin);
            let _size = size;
            let _marginChange = marginChange;
            if(!_canPlaceOrder) {
                _size = oldOrder.size; // lower risk
                const _newMargin = Math.floor(_size * newMarginPrice / 1000000);
                _marginChange = _newMargin - oldMargin;
                _canPlaceOrder = _marginChange <= 0 || canPlaceOrder(isBuy, _size, price, collateral + oldMargin);
            }
            if(_canPlaceOrder) {
                if(shouldCancelReplace(oldOrder, price, _size)) {
                    // create new cancel replace order
                    cancelReplaces.push({
                        price: price,
                        size: _size,
                        side: oldOrder.side,
                        cancelId: oldOrder.id
                    })
                    collateral += _marginChange;
                }
            } else {
                cancels.push(oldOrder.id)
                collateral -= oldMargin;
            }
        }
    }
    if(oldOrders.length < newPrices.length) { // less orders, should add more orders
        for(let i = minLength; i < newPrices.length; i++) {
            const price = newPrices[i]
            const size = roundToLot(newSizes[i] * skewMul);
            const newMargin = Math.floor(size * (isBuy ? price : 1000000 - price) / 1000000);
            const _canPlaceOrder = canPlaceOrder(isBuy, size, price, collateral);
            if(!_canPlaceOrder) continue;
            // add new order
            newOrders.push({
                price: price,
                size: size,
                side: isBuy ? "buy" : "sell"
            })
            collateral += newMargin;
        }
    } else if(oldOrders.length > newPrices.length) {
        for(let i = minLength; i < oldOrders.length; i++) {
            // cancel old order
            cancels.push(oldOrders[i].id)
        }
    }

    return { cancelReplaces, cancels, newOrders };
}

export async function runQuoteMaintenance(wallet: Wallet) {
    console.log("=============runQuoteMaintenance:start",(new Date()).toUTCString(),"============================");
    const book = STATE.book;
    if (!book) return;
    if (shouldPauseForFairValue()) {
        warn("quote maintenance skipped (oracle fair value stale)");
        await sleep(jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS));
        return;
    }

    const position = await getPositionBalance(1n, wallet.address);
    STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1)

    const epoch = await getCurrentEpoch();
    if(epoch != STATE.epoch) {
        console.log("quote maintenance skipped (epoch mismatch)", { epoch, STATE_epoch: STATE.epoch });
        return;
    }

    const bookMid = midPrice(book);
    const refPrice = referencePrice(book); // TODO: this is what needs to be adjusted to come up with a dynamic market
    console.log("book >> bids:", book.bids.length, "asks:", book.asks.length," total:", book.asks.length + book.bids.length, "mid:", bookMid, "reference:", refPrice, "fairValue:", STATE.fairValue?.protocolPrice, "oracleStale:", STATE.oracle.stale);
    const { bids: targetBidPrices, asks: targetAskPrices } = buildTargetLadderPrices(refPrice); // This builds the target prices
    const { bidSizes, askSizes } = buildTargetSizes();
    console.log("targetBids:", targetBidPrices);
    console.log("targetAsks:", targetAskPrices);
    console.log("bidSizes:", bidSizes);
    console.log("askSizes:", askSizes);
    // inventory skew: long => bias asks; short => bias bids
    // so if we are very long, we post bigger asks, if we are very short we post bigger bids. All depending how far away we are from target inventory
    // consider that inventory target can be a long or short quantity of inventory (can be negative or positive)
    const invNorm = clamp((STATE.invBase - CFG.INV_TARGET) / Math.max(1e-9, CFG.INV_MAX_ABS), -1, 1);
    console.log("invNorm:", invNorm);
    const askSkewMul = 1 + 0.30 * Math.max(0, invNorm);
    const bidSkewMul = 1 + 0.30 * Math.max(0, -invNorm);
    console.log("askSkewMul:", askSkewMul);
    console.log("bidSkewMul:", bidSkewMul);

    const pendingBids = Array.from(STATE.pendingBuys.values()) as PendingOrder[];
    const pendingSells = Array.from(STATE.pendingSells.values()) as PendingOrder[];
    const { cancelReplaces: buyCancelReplaces, cancels: buyCancels, newOrders: buyNewOrders } = prepareOrders(pendingBids, targetBidPrices, bidSizes, bidSkewMul, true);
    const { cancelReplaces: sellCancelReplaces, cancels: sellCancels, newOrders: sellNewOrders } = prepareOrders(pendingSells, targetAskPrices, askSizes, askSkewMul, false);

    const cancelReplaces = buyCancelReplaces.concat(sellCancelReplaces);
    for(let i = 0; i < cancelReplaces.length; i++) {
        const instr = cancelReplaces[i];
        try {
            await apiCancelReplaceOrder(wallet,
                {
                    epoch: Number(STATE.epoch),
                    orderHash: instr.cancelId,
                    side: instr.side,
                    price: instr.price,
                    size: instr.size,
                    allOrNothing: false
                });
            log(`cancel replace`, { price: instr.price, size: instr.size, side: instr.side, cancelId: instr.cancelId });
            //if (CFG.USE_LOCAL_LEDGER) STATE.baseBal -= Math.floor(size * price / 1000000); // USD collateral for longs
        } catch (e: any) {
            warn(`failed cancel replace cancelId: ${instr.cancelId}, price: ${instr.price}, size: ${instr.size},` +
                `side: ${instr.side}, error:`, e?.message ?? e);
        }
    }

    const cancels = buyCancels.concat(sellCancels);
    for(let i = 0; i < cancels.length; i++) {
        try {
            await apiCancelOrder(wallet, Number(STATE.epoch), cancels[i]);
            log("canceled order with id:", { id: cancels[i] });
        } catch (e: any) {
            warn(`failed to cancel id: ${cancels[i]}, error:`, e?.message ?? e);
        }
    }

    const newOrders = buyNewOrders.concat(sellNewOrders);
    for(let i = 0; i < newOrders.length; i++) {
        const instr = newOrders[i];
        try {
            await apiSendOrder(wallet,
                {
                    epoch: Number(STATE.epoch),
                    side: instr.side,
                    price: instr.price,
                    size: instr.size
                });
            log("placed order", { price: instr.price, size: instr.size, side: instr.side });
        } catch (e: any) {
            warn(`failed to place order price: ${instr.price}, size: ${instr.size}, side: ${instr.side}, error:`, e?.message ?? e);
        }
    }

    const _book = await apiGetBook(Number(STATE.epoch));
    STATE.book = _book;
    STATE.lastMid = midPrice(_book);
    const balance = await apiGetBalance();
    STATE.baseBal = Number(balance.balance - balance.pending);
    console.log("book refreshed:", STATE.lastMid, "bids:", _book.bids.length, "asks:", _book.asks.length, "total:", _book.asks.length + _book.bids.length);
    console.log("=============runQuoteMaintenance:end",(new Date()).toUTCString(),"============================");
    await sleep(jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS));
}

export async function runAggression(wallet: Wallet) {
    const book = STATE.book;
    if (!book) return;
    if (shouldPauseForFairValue()) {
        console.log("aggression skipped (oracle fair value stale)");
        return;
    }

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
    const bookMid = midPrice(book);
    const refPrice = referencePrice(book);
    console.log("mid:", bookMid, "reference:", refPrice, "fairValue:", STATE.fairValue?.protocolPrice);
    let side = chooseFairValueAggressionSide(book, refPrice); // do we have an edge to aggress in any direction?
    if (side == null) {
        log("aggression skipped (no fair value edge)", {
            bid: book.bids[0]?.price,
            ask: book.asks[0]?.price,
            reference: refPrice,
            fairValue: STATE.fairValue?.protocolPrice,
        });
        return;
    }
    console.log("side:", side);
    console.log("CFG.WIPE_LEVELS:", CFG.WIPE_LEVELS);
    console.log("asksLen:", book.asks.length, "bidsLen:", book.bids.length);

    if (side === "buy" && book.asks.length < CFG.WIPE_LEVELS) return;
    if (side === "sell" && book.bids.length < CFG.WIPE_LEVELS) return;

    const reqBuy = depthToWipe(book, "buy", CFG.WIPE_LEVELS).qty;
    const reqSell = depthToWipe(book, "sell", CFG.WIPE_LEVELS).qty;
    console.log("reqBuy:", reqBuy);
    console.log("reqSell:", reqSell);
    let tradeQty = roundToLot((side === "buy" ? reqBuy : reqSell) * (1 + CFG.SLIP_BUFFER));
    console.log("tradeQty1:", tradeQty);
    tradeQty = roundToLot(Math.floor(Math.min(tradeQty, CFG.MAX_AGGRESS_QTY)));
    console.log("tradeQty2:", tradeQty);

    const feasibleChosen = side === "buy"
        ? canAggressBuy(tradeQty, refPrice)
        : canAggressSell(tradeQty, refPrice);
    console.log("feasibleChosen:", feasibleChosen);

    if (!feasibleChosen) { // we had an edge but couldn't trade. See if we can aggress in the other direction, not due to an edge
        const other = side === "buy" ? "sell" : "buy";
        console.log("other:", other);
        const otherReq = other === "buy" ? reqBuy : reqSell;
        console.log("otherReq:", otherReq);
        let otherQty = roundToLot(Math.min(otherReq * (1 + CFG.SLIP_BUFFER), CFG.MAX_AGGRESS_QTY));
        console.log("otherQty:", otherQty);

        const feasibleOther = other === "buy"
            ? canAggressBuy(otherQty, refPrice)
            : canAggressSell(otherQty, refPrice);
        console.log("feasibleOther:", feasibleOther);

        if (!feasibleOther) {
            log("aggression skipped (not feasible)", {
                mid: bookMid, reference: refPrice, chosen: side, qty: tradeQty, baseBal: STATE.baseBal, inv: STATE.invBase,
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
            ? clamp(roundToTick(refPrice + 10 * CFG.TICK_SIZE, "sell"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE)
            : clamp(roundToTick(refPrice - 10 * CFG.TICK_SIZE, "buy"), CFG.HARD_MIN_PRICE, CFG.HARD_MAX_PRICE);

    console.log("aggressivePrice:", aggressivePrice, "side:", side, "qty:", tradeQty, "mid:", bookMid, "reference:", refPrice);
    try {
        const resp = await apiSendOrder(wallet, { epoch: Number(STATE.epoch), side, price: aggressivePrice, size: tradeQty, tif: TimeInForce.IOC });
        log("aggressed", { side, qty: tradeQty, price: aggressivePrice, mid: bookMid, reference: refPrice });

        const balance = await apiGetBalance(); // FIXME: this could be off due to caching, must account for it
        STATE.baseBal = Number(balance.balance - balance.pending);
        if(resp.data) {
            // @ts-ignore
            if(resp.data?.status == "FILLED" || resp.data?.status == "PARTIALLY_FILLED") {
                // @ts-ignore
                const tradeQty = Number(resp.data?.filled);
                if (side === "buy") {
                    STATE.invBase += tradeQty;
                } else {
                    STATE.invBase -= tradeQty;
                }
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
