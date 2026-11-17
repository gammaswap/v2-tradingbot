import type { WebSocketTradeUpdate } from "@gammaswap/v2-exchange-sdk";
import type { Wallet } from "ethers";
import {
  RUNTIME_CFG as CFG,
  RUNTIME_STATE as STATE,
  runWithBotContext,
  type BotContext,
} from "./context.js";
import {
  cancelQuotesWhileStale,
  refreshPrivateState,
  runAggression,
  runAssetEpochCheck,
  runQuoteMaintenance,
} from "./loops.js";
import { RuntimeEventQueue, type RuntimeEvent } from "./events.js";
import { resyncBook, runMarketDataLoop } from "./marketData.js";
import { hasFreshFairValue, shouldPauseForFairValue } from "./strategy.js";
import { createLocalOrderBookState, type LocalOrderBookState } from "./orderbookReducer.js";
import { errorMessage, jitter, nowMs } from "../utils/utils.js";
import { protocolValueToSafeNumber } from "../utils/protocolMath.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("coordinator");

const EPOCH_CHECK_MS = 1_000;

export type CoordinatorStepContext = {
  wallet: Wallet;
  queue: RuntimeEventQueue;
  localBook: LocalOrderBookState;
  nextEpochCheck: number;
  nextQuote: number;
  nextAggression: number;
  bookReady: boolean;
  assetReady: boolean;
  signal?: AbortSignal;
};

export async function runRuntimeCoordinator(
  wallet: Wallet,
  queue: RuntimeEventQueue,
  signal?: AbortSignal,
  botContext: BotContext = undefined as unknown as BotContext,
): Promise<void> {
  if (!botContext) {
    return runCoordinatorLoop(wallet, queue, signal);
  }
  return runWithBotContext(botContext, () => runCoordinatorLoop(wallet, queue, signal));
}

async function runCoordinatorLoop(
  wallet: Wallet,
  queue: RuntimeEventQueue,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const tradingQueue = new RuntimeEventQueue();
  const context: CoordinatorStepContext = {
    wallet,
    queue: tradingQueue,
    localBook: createLocalOrderBookState(BigInt(CFG.ASSET_ID)),
    nextEpochCheck: 0,
    nextQuote: 0,
    nextAggression: 0,
    bookReady: false,
    assetReady: true,
    signal: controller.signal,
  };

  const stop = () => {
    controller.abort();
    context.bookReady = false;
    STATE.book = null;
    queue.wake();
    tradingQueue.wake();
  };

  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();

  let marketFailure: Error | undefined;
  const marketTask = runMarketDataLoop(context, queue, tradingQueue, controller.signal).catch(
    (error: unknown) => {
      marketFailure = error instanceof Error ? error : new Error(errorMessage(error));
      stop();
    },
  );

  try {
    if (controller.signal.aborted) return;

    const ready = await resyncBook(context.localBook, controller.signal);
    if (controller.signal.aborted) {
      if (marketFailure) throw marketFailure;
      return;
    }
    if (!ready) throw new Error("unable to initialize the local orderbook");

    context.bookReady = !context.localBook.needsResync;
    await refreshPrivateState(wallet);
    context.nextEpochCheck = nowMs();
    context.nextQuote = nowMs();
    context.nextAggression = nowMs() + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);

    while (!controller.signal.aborted) {
      await runCoordinatorStep(context);
    }
    if (marketFailure) throw marketFailure;
  } finally {
    stop();
    await marketTask;
    signal?.removeEventListener("abort", stop);
  }
}

export async function runCoordinatorStep(context: CoordinatorStepContext): Promise<void> {
  const { queue, localBook, wallet } = context;
  const nextAction = Math.min(context.nextEpochCheck, context.nextQuote, context.nextAggression);
  await queue.wait(Math.max(0, nextAction - nowMs()));

  if (context.signal?.aborted) return;

  const events = queue.drain();
  const actions = processEvents(localBook, events);

  // Checked every step rather than on the quote interval so quotes come off
  // the book as soon as the reference price goes stale.
  if (!CFG.IS_TAKER && shouldPauseForFairValue(STATE.book)) {
    await cancelQuotesWhileStale(wallet);
  }
  let bookReady = context.bookReady && !localBook.needsResync;

  if (actions.needsResync && localBook.needsResync) {
    bookReady = await resyncBook(localBook, context.signal);
  }

  if (actions.needsResync || actions.ownTradeOccurred) {
    await refreshPrivateState(wallet);
  }

  const now = nowMs();
  if (now >= context.nextEpochCheck) {
    const epochBefore = STATE.epoch;
    try {
      const epochStatus = await runAssetEpochCheck(wallet);
      context.assetReady = true;
      if (epochStatus.changed || STATE.epoch !== epochBefore) {
        context.bookReady = false;
        bookReady = await resyncBook(localBook, context.signal);
        await refreshPrivateState(wallet);
      }
    } catch (error: unknown) {
      context.assetReady = false;
      bookReady = false;
      logger.warn("asset state refresh failed; trading is paused:", errorMessage(error));
    }
    context.nextEpochCheck = now + EPOCH_CHECK_MS;
  }

  context.bookReady = bookReady && !localBook.needsResync && STATE.book?.epoch === STATE.epoch;
  const tradingEnabled =
    !context.signal?.aborted &&
    context.bookReady &&
    context.assetReady &&
    STATE.asset != null &&
    !STATE.asset.isResolved;

  const oracleRepriceDue = actions.oracleChanged && hasFreshFairValue();

  if (
    tradingEnabled &&
    !CFG.IS_TAKER &&
    (now >= context.nextQuote || actions.tradeOccurred || actions.needsResync || oracleRepriceDue)
  ) {
    const result = await runQuoteMaintenance(wallet);
    if (result === "paused" && shouldPauseForFairValue(STATE.book)) {
      await cancelQuotesWhileStale(wallet);
    }
    await refreshPrivateState(wallet);
    context.nextQuote =
      result === "reprice" ? nowMs() : now + jitter(CFG.QUOTE_LOOP_MS, CFG.QUOTE_JITTER_MS);
  }

  if (tradingEnabled && CFG.IS_TAKER && now >= context.nextAggression) {
    await runAggression(wallet);
    await refreshPrivateState(wallet);
    context.nextAggression = now + jitter(CFG.AGGRESS_MS, CFG.AGGRESS_JITTER_MS);
  }
}

function processEvents(
  book: LocalOrderBookState,
  events: RuntimeEvent[],
): {
  needsResync: boolean;
  tradeOccurred: boolean;
  ownTradeOccurred: boolean;
  oracleChanged: boolean;
} {
  let needsResync = book.needsResync;
  let tradeOccurred = false;
  let ownTradeOccurred = false;
  let oracleChanged = false;

  for (const event of events) {
    if (event.type === "market-resync") {
      needsResync = true;
    } else if (event.type === "oracle-state-changed") {
      oracleChanged = true;
    } else if (
      event.type === "market-trade" &&
      event.update.assetId === book.assetId &&
      event.update.epoch === STATE.epoch
    ) {
      tradeOccurred = true;
      ownTradeOccurred = applyTradeHint(event.update) || ownTradeOccurred;
    }
  }

  return { needsResync, tradeOccurred, ownTradeOccurred, oracleChanged };
}

function applyTradeHint(update: WebSocketTradeUpdate): boolean {
  const order = STATE.pending.get(update.data.orderId);
  if (!order) return false;

  const fill = protocolValueToSafeNumber(BigInt(update.data.fill), "trade fill");
  if (fill <= 0) return false;

  STATE.invBase += order.side === "buy" ? fill : -fill;
  STATE.lastTradeTime = nowMs();
  logger.info("order execution hint", {
    orderId: update.data.orderId,
    side: order.side,
    fill,
    fillPrice: Number(update.data.fillPrice),
    seqId: update.seqId.toString(),
  });
  return true;
}
