import { apiGetBook } from "../api/api.js";
import { RUNTIME_STATE as STATE } from "./context.js";
import { RuntimeEventQueue } from "./events.js";
import {
  applyMarketUpdate,
  buildBookSnapshot,
  installBookSnapshot,
  type LocalOrderBookState,
} from "./orderbookReducer.js";
import { midPrice } from "./strategy.js";
import { errorMessage, nowMs } from "../utils/utils.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("marketData");

type MarketContext = {
  localBook: LocalOrderBookState;
  bookReady: boolean;
};

function publishLocalBook(book: LocalOrderBookState): void {
  STATE.book = buildBookSnapshot(book);
  STATE.lastMid = midPrice(STATE.book);
  STATE.bookUpdatedAtMs = nowMs();
}

export async function resyncBook(
  book: LocalOrderBookState,
  signal?: AbortSignal,
): Promise<boolean> {
  const epoch = STATE.epoch;
  book.epoch = epoch;
  book.needsResync = true;
  STATE.book = null;

  try {
    const snapshot = await apiGetBook(epoch);
    if (
      signal?.aborted ||
      STATE.epoch !== epoch ||
      snapshot.epoch !== epoch ||
      snapshot.assetId !== book.assetId
    ) {
      return false;
    }
    if (!installBookSnapshot(book, snapshot)) return false;

    publishLocalBook(book);
    return true;
  } catch (error: unknown) {
    logger.warn("orderbook resync failed:", errorMessage(error));
    return false;
  }
}

export async function runMarketDataLoop(
  context: MarketContext,
  input: RuntimeEventQueue,
  trading: RuntimeEventQueue,
  signal: AbortSignal,
): Promise<void> {
  const book = context.localBook;

  const invalidate = (reason: string, notify: boolean) => {
    book.needsResync = true;
    context.bookReady = false;
    STATE.book = null;
    if (notify) trading.publish({ type: "market-resync", reason });
  };

  while (!signal.aborted) {
    await input.wait(1_000);
    if (signal.aborted) break;

    let changed = false;

    for (const event of input.drain()) {
      if (event.type === "oracle-state-changed") {
        trading.publish(event);
        continue;
      }
      if (event.type === "market-resync") {
        invalidate(event.reason, !book.needsResync);
        continue;
      }
      if (event.type !== "market") continue;

      if (book.epoch !== STATE.epoch) {
        invalidate("asset epoch changed", !book.needsResync);
        book.epoch = STATE.epoch;
      }

      const update = event.update;
      // An installed snapshot may already include queued updates.
      if (
        !book.needsResync &&
        update.assetId === book.assetId &&
        update.epoch === book.epoch &&
        book.seqId !== null &&
        update.seqId <= book.seqId
      ) {
        continue;
      }

      const wasSynchronized = !book.needsResync;
      const result = applyMarketUpdate(book, update);

      if (result === "buffered" || result === "invalid") {
        invalidate("orderbook sequence requires resync", wasSynchronized);
      } else if (result === "applied") {
        changed = true;
        if (update.type === "trade") {
          trading.publish({ type: "market-trade", update });
        }
      }
    }

    if (changed && !book.needsResync && book.epoch === STATE.epoch) {
      publishLocalBook(book);
    }
  }
}
