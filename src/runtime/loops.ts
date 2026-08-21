import { CFG } from "../config/config.js";
import {
    apiCancelOrder,
    apiCancelReplaceOrder,
    apiClaim,
    apiGetBalance,
    apiGetAsset,
    apiGetPending,
    apiGetPosition,
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
    chooseFairValueAggressionSide,
    depthToWipe,
    canAggressBuy,
    canAggressSell,
} from "./strategy.js";
import { Wallet, ZeroHash } from "ethers";
import { markFairValueStale, updateFairValueFromOracle } from "./fairValue.js";
import { PendingOrder, AssetEpochCheckResult } from "../utils/types.js";
import { TimeInForce } from "@gammaswap/v2-exchange-sdk";
import { planOrders } from "./orderPlanner.js";
import { canTradeCurrentAsset } from "./tradingGuards.js";
import { reconcileAssetEpoch } from "./assetLifecycle.js";

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

export async function cancelAllOrders(wallet: Wallet, startingEpoch: bigint = STATE.epoch) {
    let epoch = startingEpoch;
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

export async function runAssetEpochCheck(wallet: Wallet): Promise<AssetEpochCheckResult> {
    console.log("=============runAssetEpochCheck:start",(new Date()).toUTCString(),"============================");
    const currentAsset = await apiGetAsset();
    const result = await reconcileAssetEpoch(STATE, currentAsset, wallet, {
        getPosition: async (epoch) => apiGetPosition(epoch),
        claim: async (claimWallet, epoch) => apiClaim(claimWallet, epoch),
        hasPendingOrders,
        cancelAllOrders,
        refreshFairValue: () => {
            if (STATE.oracle.price != null) updateFairValueFromOracle(STATE.oracle.price, STATE.oracle.ts);
        },
        markResolved: markFairValueStale,
    });
    console.log("asset refreshed:", STATE.asset);
    console.log("=============runAssetEpochCheck:end",(new Date()).toUTCString(),"============================");
    return result;
}

export async function refreshPrivateState(wallet: Wallet): Promise<void> {
    const epoch = STATE.epoch;
    console.log("=============refreshPrivateState:start", epoch.toString(), "============================");

    try {
        const [pendingResp, balance, position] = await Promise.all([
            apiGetPending(wallet.address, epoch),
            apiGetBalance(),
            apiGetPosition(epoch),
        ]);

        // Do not apply a snapshot for an epoch that changed while requests were pending.
        if (STATE.epoch !== epoch) return;

        applyPendingResponse(pendingResp);
        STATE.baseBal = Number(balance.balance - balance.pending);
        STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1);
        console.log("trading state refreshed:", {
            pending: STATE.pending.size,
            baseBal: STATE.baseBal,
            invBase: STATE.invBase,
        });
    } catch (e: any) {
        warn("private state refresh error:", e?.message ?? e);
    }

    console.log("=============refreshPrivateState:end",(new Date()).toUTCString(),"============================");
}

function applyPendingResponse(pendingResp: Awaited<ReturnType<typeof apiGetPending>>): void {
    const next = new Map<string, PendingOrder>();
    STATE.pendingBuys.clear();
    STATE.pendingSells.clear();

    for (const [orders, side] of [
        [pendingResp.buys ?? [], "buy"],
        [pendingResp.sells ?? [], "sell"],
    ] as const) {
        for (const o of orders) {
            const order = {
                id: String(o.id),
                side,
                price: Number(o.price),
                size: Number(o.size),
                time: Number(o.time),
                account: o.account,
                epoch: BigInt(pendingResp.epoch),
            } as PendingOrder;
            const orderKey = getOrderKey(order);
            if (side === "buy") STATE.pendingBuys.set(orderKey, order);
            else STATE.pendingSells.set(orderKey, order);
            next.set(order.id, order);
        }
    }

    STATE.pending = next;
}


export async function runQuoteMaintenance(wallet: Wallet) {
    console.log("=============runQuoteMaintenance:start",(new Date()).toUTCString(),"============================");
    const book = STATE.book;
    if (!book) return;
    if (!canTradeCurrentAsset(STATE)) {
        log("quote maintenance skipped: current asset is unavailable or resolved");
        return;
    }
    if (shouldPauseForFairValue()) {
        warn("quote maintenance skipped (oracle fair value stale)");
        return;
    }

    const bookMid = midPrice(book);
    const refPrice = referencePrice(book);
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
    const { cancelReplaces: buyCancelReplaces, cancels: buyCancels, newOrders: buyNewOrders } = planOrders(pendingBids, targetBidPrices, bidSizes, bidSkewMul, "buy");
    const { cancelReplaces: sellCancelReplaces, cancels: sellCancels, newOrders: sellNewOrders } = planOrders(pendingSells, targetAskPrices, askSizes, askSkewMul, "sell");

    const cancelReplaces = buyCancelReplaces.concat(sellCancelReplaces);
    for(let i = 0; i < cancelReplaces.length; i++) {
        const instr = cancelReplaces[i];
        try {
            await apiCancelReplaceOrder(wallet,
                {
                    epoch: STATE.epoch,
                    orderHash: instr.cancelId,
                    side: instr.side,
                    price: instr.price,
                    size: instr.size,
                    allOrNothing: false
                });
            log(`cancel replace`, { price: instr.price, size: instr.size, side: instr.side, cancelId: instr.cancelId });
        } catch (e: any) {
            warn(`failed cancel replace cancelId: ${instr.cancelId}, price: ${instr.price}, size: ${instr.size},` +
                `side: ${instr.side}, error:`, e?.message ?? e);
        }
    }

    const cancels = buyCancels.concat(sellCancels);
    for(let i = 0; i < cancels.length; i++) {
        try {
            await apiCancelOrder(wallet, STATE.epoch, cancels[i]);
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
                    epoch: STATE.epoch,
                    side: instr.side,
                    price: instr.price,
                    size: instr.size
                });
            log("placed order", { price: instr.price, size: instr.size, side: instr.side });
        } catch (e: any) {
            warn(`failed to place order price: ${instr.price}, size: ${instr.size}, side: ${instr.side}, error:`, e?.message ?? e);
        }
    }

    console.log("=============runQuoteMaintenance:end",(new Date()).toUTCString(),"============================");
}

export async function runAggression(wallet: Wallet) {
    const book = STATE.book;
    if (!book) return;
    if (!canTradeCurrentAsset(STATE)) {
        log("aggression skipped: current asset is unavailable or resolved");
        return;
    }
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
        const resp = await apiSendOrder(wallet, { epoch: STATE.epoch, side, price: aggressivePrice, size: tradeQty, tif: TimeInForce.IOC });
        log("aggressed", { side, qty: tradeQty, price: aggressivePrice, mid: bookMid, reference: refPrice });

        const balance = await apiGetBalance();
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

    console.log("========================runAggression:end",(new Date()).toUTCString(),"==========================");
}
