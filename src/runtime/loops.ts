import { RUNTIME_CFG as CFG, RUNTIME_STATE as STATE } from "./context.js";
import {
  apiCancelOrder,
  apiCancelReplaceOrder,
  apiClaim,
  apiGetBalance,
  apiGetClaimable,
  apiGetAsset,
  apiGetPending,
  apiGetPosition,
  apiSendOrder,
} from "../api/api.js";
import {
  errorMessage,
  jitter,
  nowMs,
  sleep,
  clamp,
  roundToTick,
  roundToOrderLot,
  getOrderKey,
} from "../utils/utils.js";
import {
  midPrice,
  referencePrice,
  shouldPauseForFairValue,
  shouldPauseForAggression,
  buildTargetLadderPrices,
  LADDER_PRICE_MODEL,
  distributeTotalSizeAcrossLadder,
  chooseAggressionSide,
  depthToWipe,
  canAggressBuy,
  canAggressSell,
  capOrderSizeByMargin,
  calculateCurrentRiskAversion,
  calculateBidAndAsk,
  calculateInventorySkew,
  calculateTotalSizes,
} from "./strategy.js";
import { Wallet, ZeroHash } from "ethers";
import { markFairValueStale, updateFairValueFromOracle } from "./fairValue.js";
import { PendingOrder, AssetEpochCheckResult } from "../utils/types.js";
import { TimeInForce } from "@gammaswap/v2-exchange-sdk";
import { makeQuoteSlot, planOrders } from "./orderPlanner.js";
import { canTradeCurrentAsset } from "./tradingGuards.js";
import { reconcileAssetEpoch } from "./assetLifecycle.js";
import { RUNTIME_ORDER_INTENTS as ORDER_INTENTS } from "./context.js";
import {
  handleCancelReplaceResponse,
  handleCancelResponse,
  handlePlaceOrderResponse,
} from "./intentResponses.js";
import { RUNTIME_QUOTE_COOLDOWNS as QUOTE_COOLDOWNS } from "./context.js";
import { protocolValueToSafeNumber } from "../utils/protocolMath.js";
import { PROTOCOL_TICK_SIZE } from "../utils/protocolPrice.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("loops");

export async function hasPendingOrders() {
  const resp = await apiGetBalance();
  logger.info("cleanUpAllOrders:cancel all orders >> pending", resp.pending);
  const hasPendingBalance = resp.pending >= CFG.DUST_BALANCE;
  await sleep(1000 * 2);
  return hasPendingBalance;
}

export async function cleanUpAllOrders(wallet: Wallet) {
  let done = false;
  let tryCount = 0;
  while (!done) {
    if (await hasPendingOrders()) {
      logger.info("cleanUpAllOrders:cancel all orders >> tryCount:", tryCount);
      await cancelAllOrders(wallet);
      tryCount++;
    } else {
      logger.info("cleanUpAllOrders:done");
      done = true;
    }
    if (tryCount >= 10) {
      logger.info("cleanUpAllOrders:cancel all orders >> max tryCount reached");
      done = true;
    }
  }
}

export async function cancelAllOrders(wallet: Wallet, startingEpoch: bigint = STATE.epoch) {
  let epoch = startingEpoch;
  let done = false;
  logger.info("==============cancelAllOrders:start", epoch, "========================");
  while (!done && epoch >= 0n) {
    logger.info("cancelAllOrders:epoch:", epoch);
    // look for pending orders
    const pending = await apiGetPending(STATE.account, epoch);
    if (pending.buys.length > 0 || pending.sells.length > 0) {
      // has pending orders, send cancel all
      logger.info(
        "cancelAllOrders:cancel all orders >> pending.buys:",
        pending.buys.length,
        "pending.sells:",
        pending.sells.length,
        "epoch:",
        epoch,
      );
      await apiCancelOrder(wallet, epoch, ZeroHash);
      epoch--;
    } else {
      logger.info("cancelAllOrders:skipping: epoch:", epoch);
      epoch--;
    }
    await sleep(1000 * 3);

    const resp = await apiGetBalance();
    if (resp.pending < CFG.DUST_BALANCE) {
      logger.warn("Error: Pending balance > 0, pending:", resp.pending);
      done = true;
      return;
    }

    await sleep(1000 * 3);
  }
  logger.info("==============cancelAllOrders:end", epoch, "========================");
}

/**
 * Cancels orders during graceful process shutdown without relying on the
 * account-balance cleanup loop. A zero order hash means cancel-all for the
 * specified asset and epoch. Pending-order snapshots are checked after each
 * request because an accepted cancel request may still be processing.
 */
export async function cancelAllOpenOrdersOnShutdown(
  wallet: Wallet,
  startingEpoch: bigint = STATE.epoch,
): Promise<void> {
  const maxAttempts = 5;
  const retryDelayMs = 1_000;

  // Fast path: pending balance is the collateral reserved by open orders.
  // When it is below the dust threshold, there is no reason to scan every
  // historical epoch for orders.
  const initialBalance = await apiGetBalance();
  if (initialBalance.pending < CFG.DUST_BALANCE) {
    logger.info("shutdown cancellation complete: no pending balance", {
      pending: initialBalance.pending.toString(),
    });
    return;
  }

  for (let epoch = startingEpoch; epoch >= 0n; epoch--) {
    let pending = await apiGetPending(STATE.account, epoch);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (pending.buys.length === 0 && pending.sells.length === 0) break;

      logger.info("submitting shutdown cancel-all", {
        epoch: epoch.toString(),
        buys: pending.buys.length,
        sells: pending.sells.length,
        attempt,
      });
      await apiCancelOrder(wallet, epoch, ZeroHash);

      await sleep(retryDelayMs);
      pending = await apiGetPending(STATE.account, epoch);
    }

    if (pending.buys.length > 0 || pending.sells.length > 0) {
      logger.error("shutdown could not confirm all orders cancelled", {
        epoch: epoch.toString(),
        buys: pending.buys.length,
        sells: pending.sells.length,
      });
    }

    // Once the exchange reports no meaningful pending balance, there is
    // no need to inspect older epochs.
    const balance = await apiGetBalance();
    if (balance.pending < CFG.DUST_BALANCE) {
      logger.info("shutdown cancellation complete", {
        pending: balance.pending.toString(),
        lastCheckedEpoch: epoch.toString(),
      });
      return;
    }
  }

  logger.error("shutdown cancellation finished with pending balance remaining");
}

export async function runAssetEpochCheck(wallet: Wallet): Promise<AssetEpochCheckResult> {
  logger.info("=============runAssetEpochCheck:start============================");
  const currentAsset = await apiGetAsset();
  const result = await reconcileAssetEpoch(STATE, currentAsset, wallet, {
    getClaimable: async (epoch) => (await apiGetClaimable(epoch)).claimable,
    claim: async (claimWallet, epoch) => apiClaim(claimWallet, epoch),
    hasPendingOrders,
    cancelAllOrders,
    refreshFairValue: () => {
      if (STATE.oracle.price != null)
        updateFairValueFromOracle(STATE.oracle.price, STATE.oracle.ts);
    },
    markResolved: markFairValueStale,
  });
  logger.info("asset refreshed:", STATE.asset);
  logger.info("=============runAssetEpochCheck:end============================");
  return result;
}

export async function refreshPrivateState(wallet: Wallet): Promise<void> {
  const epoch = STATE.epoch;
  logger.info(
    "=============refreshPrivateState:start",
    epoch.toString(),
    "============================",
  );

  try {
    const [pendingResp, balance, position] = await Promise.all([
      apiGetPending(wallet.address, epoch),
      apiGetBalance(),
      apiGetPosition(epoch),
    ]);

    // Do not apply a snapshot for an epoch that changed while requests were pending.
    if (STATE.epoch !== epoch) return;

    applyPendingResponse(pendingResp);
    STATE.accountBalance = protocolValueToSafeNumber(balance.balance, "account balance");
    STATE.baseBal = protocolValueToSafeNumber(
      balance.balance - balance.pending,
      "available base balance",
    );
    STATE.invBase =
      protocolValueToSafeNumber(position.balance, "position balance") * (position.bSide ? -1 : 1);
    logger.info("trading state refreshed:", {
      pending: STATE.pending.size,
      baseBal: STATE.baseBal,
      invBase: STATE.invBase,
    });
  } catch (e: unknown) {
    logger.warn("private state refresh error:", errorMessage(e));
  }

  logger.info("=============refreshPrivateState:end============================");
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
      };
      const orderKey = getOrderKey(order);
      if (side === "buy") STATE.pendingBuys.set(orderKey, order);
      else STATE.pendingSells.set(orderKey, order);
      next.set(order.id, order);
    }
  }

  STATE.pending = next;
}

export async function runQuoteMaintenance(wallet: Wallet) {
  if (CFG.IS_TAKER) {
    logger.debug("quote maintenance skipped: bot is configured as taker");
    return;
  }
  logger.info("=============runQuoteMaintenance:start============================");
  const book = STATE.book;
  if (!book) return;
  if (!canTradeCurrentAsset(STATE)) {
    logger.info("quote maintenance skipped: current asset is unavailable or resolved");
    return;
  }
  if (shouldPauseForFairValue(book)) {
    logger.warn("quote maintenance skipped: reference price is stale or unavailable");
    return;
  }

  await reconcileCancelReplaceIntents(wallet);
  await reconcilePlaceIntents(wallet);

  const bookMid = midPrice(book);
  const refPrice = referencePrice(book);
  const gamma = calculateCurrentRiskAversion(STATE.asset!);
  const inventorySkew = calculateInventorySkew(gamma, STATE.invBase, refPrice);
  const calculatedBidAsk = calculateBidAndAsk(refPrice, inventorySkew, CFG.LOGIT_HALF_SPREAD);
  const calculatedMid = (calculatedBidAsk.bid + calculatedBidAsk.ask) / 2;
  logger.debug(
    "book >> bids:",
    book.bids.length,
    "asks:",
    book.asks.length,
    " total:",
    book.asks.length + book.bids.length,
    "mid:",
    bookMid,
    "reference:",
    refPrice,
    "calculatedBidAsk:",
    calculatedBidAsk,
    "calculatedMid:",
    calculatedMid,
    "gamma:",
    gamma,
    "inventorySkew:",
    inventorySkew,
    "fairValue:",
    STATE.fairValue?.protocolPrice,
    "oracleStale:",
    STATE.oracle.stale,
  );
  const calculatedTargets = buildTargetLadderPrices(
    book,
    refPrice,
    calculatedBidAsk.bid,
    calculatedBidAsk.ask,
    CFG.LADDER_PRICE_MODEL === LADDER_PRICE_MODEL.GROWTH_SPACE
      ? LADDER_PRICE_MODEL.GROWTH_SPACE
      : LADDER_PRICE_MODEL.EQUIDISTANT,
  );
  logger.debug("calculated target ladder:", calculatedTargets);
  const { bids: targetBidPrices, asks: targetAskPrices } = calculatedTargets;
  const { bidSize, askSize } = calculateTotalSizes(STATE.asset!);
  STATE.quoteModel = {
    updatedAtMs: Date.now(),
    bookMid,
    referencePrice: refPrice,
    gamma,
    inventorySkew,
    calculatedBid: calculatedBidAsk.bid,
    calculatedAsk: calculatedBidAsk.ask,
    calculatedMid,
    bidSize,
    askSize,
  };
  const bidSizes = distributeTotalSizeAcrossLadder(bidSize, targetBidPrices, "buy");
  const askSizes = distributeTotalSizeAcrossLadder(askSize, targetAskPrices, "sell");
  logger.debug(
    "targetBids:",
    targetBidPrices,
    "\ntargetAsks:",
    targetAskPrices,
    "\nbidSizes:",
    bidSizes,
    "\naskSizes:",
    askSizes,
  );
  const pendingBids = Array.from(STATE.pendingBuys.values()) as PendingOrder[];
  const pendingSells = Array.from(STATE.pendingSells.values()) as PendingOrder[];
  const {
    cancelReplaces: buyCancelReplaces,
    cancels: buyCancels,
    newOrders: buyNewOrders,
  } = planOrders(pendingBids, targetBidPrices, bidSizes, "buy");
  const {
    cancelReplaces: sellCancelReplaces,
    cancels: sellCancels,
    newOrders: sellNewOrders,
  } = planOrders(pendingSells, targetAskPrices, askSizes, "sell");

  const cancelReplaces = buyCancelReplaces.concat(sellCancelReplaces);
  for (let i = 0; i < cancelReplaces.length; i++) {
    const instr = cancelReplaces[i];
    const quoteSlot = instr.quoteSlot ?? makeQuoteSlot(instr.side, instr.price);
    const existingReplacement = ORDER_INTENTS.getOutstanding("cancel-replace").find(
      (intent) =>
        intent.kind === "cancel-replace" &&
        intent.epoch === STATE.epoch &&
        intent.targetOrderHash === instr.cancelId,
    );
    if (existingReplacement && existingReplacement.status !== "unknown") {
      continue;
    }
    if (existingReplacement && !ORDER_INTENTS.canAttempt(existingReplacement)) {
      continue;
    }
    const intent =
      existingReplacement ??
      ORDER_INTENTS.getOrCreate({
        kind: "cancel-replace",
        assetId: CFG.ASSET_ID,
        epoch: STATE.epoch,
        slot: quoteSlot,
        side: instr.side,
        price: instr.price,
        size: instr.size,
        targetOrderHash: instr.cancelId,
      });
    ORDER_INTENTS.markAttempted(intent);
    try {
      const response = await apiCancelReplaceOrder(wallet, {
        epoch: STATE.epoch,
        orderHash: instr.cancelId,
        side: instr.side,
        price: instr.price,
        size: instr.size,
        allOrNothing: false,
        timeInForce: 3n,
        nonce: intent.nonce,
        replacementNonce: intent.replacementNonce!,
      });
      handleCancelReplaceResponse(intent, response);
      logger.info(`cancel replace`, {
        price: instr.price,
        size: instr.size,
        side: instr.side,
        cancelId: instr.cancelId,
      });
    } catch (e: unknown) {
      ORDER_INTENTS.markUnknown(intent);
      logger.warn(
        `failed cancel replace cancelId: ${instr.cancelId}, price: ${instr.price}, ` +
          `size: ${instr.size}, side: ${instr.side}, error:`,
        errorMessage(e),
      );
    }
  }

  const cancels = buyCancels.concat(sellCancels);
  for (const orderHash of cancels) {
    ORDER_INTENTS.getOrCreate({
      kind: "cancel",
      assetId: CFG.ASSET_ID,
      epoch: STATE.epoch,
      slot: orderHash,
      targetOrderHash: orderHash,
    });
  }

  if (!(await reconcileOrderIntents(wallet))) {
    logger.warn("quote maintenance paused: unresolved cancellations remain");
    return;
  }

  const newOrders = buyNewOrders.concat(sellNewOrders);
  for (let i = 0; i < newOrders.length; i++) {
    const instr = newOrders[i];
    const slot = instr.quoteSlot ?? makeQuoteSlot(instr.side, instr.price);
    if (
      QUOTE_COOLDOWNS.isCoolingDown({
        assetId: CFG.ASSET_ID,
        epoch: STATE.epoch,
        quoteSlot: slot,
      })
    ) {
      continue;
    }
    const existingPlace = ORDER_INTENTS.getOutstanding("place").find(
      (candidate) =>
        candidate.kind === "place" && candidate.epoch === STATE.epoch && candidate.slot === slot,
    );
    if (
      existingPlace &&
      (existingPlace.status !== "unknown" || !ORDER_INTENTS.canAttempt(existingPlace))
    ) {
      continue;
    }
    const intent =
      existingPlace ??
      ORDER_INTENTS.getOrCreate({
        kind: "place",
        assetId: CFG.ASSET_ID,
        epoch: STATE.epoch,
        slot,
        side: instr.side,
        price: instr.price,
        size: instr.size,
        timeInForce: 3n,
      });
    if (intent.kind !== "place") continue;
    ORDER_INTENTS.markAttempted(intent);
    try {
      const response = await apiSendOrder(wallet, {
        epoch: STATE.epoch,
        side: intent.side,
        price: intent.price,
        size: intent.size,
        tif: 3n,
        nonce: intent.nonce,
      });
      handlePlaceOrderResponse(intent, response);
      logger.info("placed order", { price: instr.price, size: instr.size, side: instr.side });
    } catch (e: unknown) {
      ORDER_INTENTS.markUnknown(intent);
      logger.warn(
        `failed to place order price: ${instr.price}, size: ${instr.size}, side: ${instr.side}, error:`,
        errorMessage(e),
      );
    }
  }

  logger.info(
    "=============runQuoteMaintenance:end",
    new Date().toUTCString(),
    "============================",
  );
}

/**
 * Verifies that every outstanding ordinary cancellation has reached a
 * terminal target-order state before passive orders are placed. A target that
 * disappeared from pending orders is considered complete: it was canceled or
 * filled before the cancellation could finish.
 */
export async function reconcileOrderIntents(wallet: Wallet): Promise<boolean> {
  const cancellations = ORDER_INTENTS.getOutstanding("cancel");
  if (cancellations.length === 0) return true;

  const pendingByEpoch = new Map<string, Set<string>>();
  for (const intent of cancellations) {
    const epochKey = intent.epoch.toString();
    if (pendingByEpoch.has(epochKey)) continue;
    try {
      const pending = await apiGetPending(wallet.address, intent.epoch);
      pendingByEpoch.set(
        epochKey,
        new Set([
          ...pending.buys.map((order) => order.id),
          ...pending.sells.map((order) => order.id),
        ]),
      );
    } catch (e: unknown) {
      logger.warn(`unable to reconcile cancellations for epoch ${epochKey}:`, errorMessage(e));
      return false;
    }
  }

  let attemptedCancellation = false;

  for (const intent of cancellations) {
    if (intent.kind !== "cancel") continue;
    const pending = pendingByEpoch.get(intent.epoch.toString());
    if (pending?.has(intent.targetOrderHash)) {
      if (!ORDER_INTENTS.canAttempt(intent)) continue;
      attemptedCancellation = true;
      ORDER_INTENTS.markAttempted(intent);
      try {
        const response = await apiCancelOrder(
          wallet,
          intent.epoch,
          intent.targetOrderHash,
          intent.nonce,
        );
        handleCancelResponse(intent, response);
        logger.info("cancellation submitted", {
          id: intent.targetOrderHash,
          attempt: intent.attempts,
        });
      } catch (e: unknown) {
        ORDER_INTENTS.markUnknown(intent);
        logger.warn(`failed to cancel id: ${intent.targetOrderHash}, error:`, errorMessage(e));
      }
    } else {
      ORDER_INTENTS.markCompleted(intent);
    }
  }

  // Re-read pending state after submitting cancellations. This prevents new
  // orders from being placed merely because the cancellation request was
  // accepted while the old order was still active.
  const remaining = ORDER_INTENTS.getOutstanding("cancel");
  if (remaining.length === 0) return true;
  if (!attemptedCancellation) return false;

  const verificationByEpoch = new Map<string, Set<string>>();

  for (const intent of remaining) {
    if (intent.kind !== "cancel") continue;
    const epochKey = intent.epoch.toString();
    try {
      let pendingIds = verificationByEpoch.get(epochKey);
      if (!pendingIds) {
        const result = await apiGetPending(wallet.address, intent.epoch);
        pendingIds = new Set([
          ...result.buys.map((order) => order.id),
          ...result.sells.map((order) => order.id),
        ]);
        verificationByEpoch.set(epochKey, pendingIds);
      }
      const stillPending = pendingIds?.has(intent.targetOrderHash) ?? false;
      if (!stillPending) ORDER_INTENTS.markCompleted(intent);
    } catch (e: unknown) {
      logger.warn(`unable to verify cancellation ${intent.targetOrderHash}:`, errorMessage(e));
    }
  }

  return ORDER_INTENTS.getOutstanding("cancel").length === 0;
}

/**
 * Passive orders do not need to reserve a quote slot forever after the API has
 * accepted them. Once the pending snapshot has observed the request hash, the
 * request is no longer retryable. If an accepted order is absent, it has also
 * reached a terminal state from the bot's perspective (filled, canceled, or
 * otherwise removed by the relayer).
 *
 * Unknown requests are kept retryable when they are absent because the bot
 * still does not know whether the original submission reached the relayer.
 */
export async function reconcilePlaceIntents(wallet: Wallet): Promise<void> {
  const places = ORDER_INTENTS.getOutstanding("place").filter(
    (intent) => intent.kind === "place" && intent.timeInForce !== TimeInForce.IOC,
  );
  if (places.length === 0) return;

  const pendingByEpoch = new Map<string, Set<string>>();
  for (const intent of places) {
    const epochKey = intent.epoch.toString();
    if (pendingByEpoch.has(epochKey)) continue;
    try {
      const pending = await apiGetPending(wallet.address, intent.epoch);
      pendingByEpoch.set(
        epochKey,
        new Set([
          ...pending.buys.map((order) => order.id),
          ...pending.sells.map((order) => order.id),
        ]),
      );
      if (intent.epoch === STATE.epoch) applyPendingResponse(pending);
    } catch (e: unknown) {
      logger.warn(`unable to reconcile passive orders for epoch ${epochKey}:`, errorMessage(e));
    }
  }

  for (const intent of places) {
    if (intent.kind !== "place") continue;
    const pending = pendingByEpoch.get(intent.epoch.toString());
    const requestIsPending = intent.requestHash != null && pending?.has(intent.requestHash);
    if (intent.status === "accepted" || requestIsPending) {
      ORDER_INTENTS.markCompleted(intent);
    }
  }
}

/**
 * A target order may have one unresolved cancel-replace at a time. Once the
 * target disappears from pending orders, the cancel leg has reached a terminal
 * state and a later quote pass may plan a new replacement if needed.
 */
export async function reconcileCancelReplaceIntents(wallet: Wallet): Promise<void> {
  const replacements = ORDER_INTENTS.getOutstanding("cancel-replace");
  const pendingByEpoch = new Map<string, Set<string>>();

  for (const intent of replacements) {
    if (intent.kind !== "cancel-replace") continue;
    const epochKey = intent.epoch.toString();
    if (pendingByEpoch.has(epochKey)) continue;
    try {
      const pending = await apiGetPending(wallet.address, intent.epoch);
      pendingByEpoch.set(
        epochKey,
        new Set([
          ...pending.buys.map((order) => order.id),
          ...pending.sells.map((order) => order.id),
        ]),
      );
      if (intent.epoch === STATE.epoch) applyPendingResponse(pending);
    } catch (e: unknown) {
      logger.warn(`unable to reconcile cancel-replaces for epoch ${epochKey}:`, errorMessage(e));
    }
  }

  for (const intent of replacements) {
    if (intent.kind !== "cancel-replace") continue;
    const pending = pendingByEpoch.get(intent.epoch.toString());
    if (pending && !pending.has(intent.targetOrderHash)) {
      ORDER_INTENTS.markCompleted(intent);
    }
  }
}

export async function runAggression(wallet: Wallet) {
  if (!CFG.IS_TAKER) {
    logger.debug("aggression skipped: bot is configured as maker");
    return;
  }
  const book = STATE.book;
  if (!book) return;
  if (!canTradeCurrentAsset(STATE)) {
    logger.info("aggression skipped: current asset is unavailable or resolved");
    return;
  }
  if (shouldPauseForAggression(book)) {
    logger.info("aggression skipped: reference price is stale or unavailable");
    return;
  }

  const currTime = nowMs();
  const tradeDelay = jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);
  const msSinceLastTrade = currTime - STATE.lastTradeTime;
  if (msSinceLastTrade < tradeDelay) {
    logger.info("aggression skipped (trade delay)", { msSinceLastTrade, tradeDelay });
    return;
  }
  STATE.lastTradeTime = currTime;

  logger.info("========================runAggression:start==========================");
  const bookMid = midPrice(book);
  const refPrice = referencePrice(book);
  logger.debug(
    "mid:",
    bookMid,
    "reference:",
    refPrice,
    "fairValue:",
    STATE.fairValue?.protocolPrice,
  );
  let side = chooseAggressionSide(book, refPrice);
  if (side == null) {
    logger.info("aggression skipped (model selected no trade)", {
      bid: book.bids[0]?.price,
      ask: book.asks[0]?.price,
      reference: refPrice,
      fairValue: STATE.fairValue?.protocolPrice,
    });
    return;
  }
  logger.debug("side:", side);
  logger.debug("CFG.WIPE_LEVELS:", CFG.WIPE_LEVELS);
  logger.debug("asksLen:", book.asks.length, "bidsLen:", book.bids.length);

  if (side === "buy" && book.asks.length < CFG.WIPE_LEVELS) return;
  if (side === "sell" && book.bids.length < CFG.WIPE_LEVELS) return;

  const reqBuy = depthToWipe(book, "buy", CFG.WIPE_LEVELS).qty;
  const reqSell = depthToWipe(book, "sell", CFG.WIPE_LEVELS).qty;
  logger.debug("reqBuy:", reqBuy);
  logger.debug("reqSell:", reqSell);
  let tradeQty = roundToOrderLot((side === "buy" ? reqBuy : reqSell) * (1 + CFG.SLIP_BUFFER));
  logger.debug("tradeQty1:", tradeQty);
  tradeQty = roundToOrderLot(Math.min(tradeQty, CFG.MAX_AGGRESS_QTY));
  tradeQty = capOrderSizeByMargin(side === "buy", tradeQty, refPrice);
  logger.debug("tradeQty2:", tradeQty);

  const feasibleChosen =
    side === "buy" ? canAggressBuy(tradeQty, refPrice) : canAggressSell(tradeQty, refPrice);
  logger.debug("feasibleChosen:", feasibleChosen);

  if (!feasibleChosen) {
    // we had an edge but couldn't trade. See if we can aggress in the other direction, not due to an edge
    const other = side === "buy" ? "sell" : "buy";
    logger.debug("other:", other);
    const otherReq = other === "buy" ? reqBuy : reqSell;
    logger.debug("otherReq:", otherReq);
    let otherQty = roundToOrderLot(Math.min(otherReq * (1 + CFG.SLIP_BUFFER), CFG.MAX_AGGRESS_QTY));
    otherQty = capOrderSizeByMargin(other === "buy", otherQty, refPrice);
    logger.debug("otherQty:", otherQty);

    const feasibleOther =
      other === "buy" ? canAggressBuy(otherQty, refPrice) : canAggressSell(otherQty, refPrice);
    logger.debug("feasibleOther:", feasibleOther);

    if (!feasibleOther) {
      logger.info("aggression skipped (not feasible)", {
        mid: bookMid,
        reference: refPrice,
        chosen: side,
        qty: tradeQty,
        baseBal: STATE.baseBal,
        inv: STATE.invBase,
      });
      return;
    }
    side = other;
    tradeQty = otherQty;
    logger.debug("side:", side);
    logger.debug("tradeQty:", tradeQty);
  }

  logger.debug("TICK_SIZE:", PROTOCOL_TICK_SIZE);
  const aggressivePrice =
    side === "buy"
      ? clamp(
          roundToTick(refPrice + 10 * PROTOCOL_TICK_SIZE, "sell"),
          CFG.HARD_MIN_PRICE,
          CFG.HARD_MAX_PRICE,
        )
      : clamp(
          roundToTick(refPrice - 10 * PROTOCOL_TICK_SIZE, "buy"),
          CFG.HARD_MIN_PRICE,
          CFG.HARD_MAX_PRICE,
        );

  logger.debug(
    "aggressivePrice:",
    aggressivePrice,
    "side:",
    side,
    "qty:",
    tradeQty,
    "mid:",
    bookMid,
    "reference:",
    refPrice,
  );
  try {
    const intent = ORDER_INTENTS.getOrCreate({
      kind: "place",
      assetId: CFG.ASSET_ID,
      epoch: STATE.epoch,
      slot: `aggression-${side}`,
      side,
      price: aggressivePrice,
      size: tradeQty,
      timeInForce: TimeInForce.IOC,
    });
    ORDER_INTENTS.markAttempted(intent);
    const resp = await apiSendOrder(wallet, {
      epoch: STATE.epoch,
      side,
      price: aggressivePrice,
      size: tradeQty,
      tif: TimeInForce.IOC,
      nonce: intent.nonce,
    });
    handlePlaceOrderResponse(intent, resp);
    logger.info("aggressed", {
      side,
      qty: tradeQty,
      price: aggressivePrice,
      mid: bookMid,
      reference: refPrice,
    });

    const balance = await apiGetBalance();
    STATE.baseBal = protocolValueToSafeNumber(
      balance.balance - balance.pending,
      "available base balance",
    );
    if (resp.data) {
      const responseData = resp.data as { status?: string; filled?: string | number | bigint } | undefined;
      if (responseData?.status === "FILLED" || responseData?.status === "PARTIALLY_FILLED") {
        const tradeQty = protocolValueToSafeNumber(
          BigInt(responseData.filled ?? 0),
          "aggression fill",
        );
        if (side === "buy") {
          STATE.invBase += tradeQty;
        } else {
          STATE.invBase -= tradeQty;
        }
      }
    }
  } catch (e: unknown) {
    logger.warn("aggression error:", errorMessage(e));
  }

  logger.info("========================runAggression:end==========================");
}
