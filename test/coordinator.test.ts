import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeEventQueue } from "../src/runtime/events.js";
import { createLocalOrderBookState } from "../src/runtime/orderbookReducer.js";
import { createInitialState } from "../src/runtime/state.js";
import type { Asset } from "../src/utils/types.js";

const apiGetBook = vi.fn();
vi.mock("../src/api/api.js", () => ({ apiGetBook }));

const refreshPrivateState = vi.fn().mockResolvedValue(undefined);
const runAggression = vi.fn().mockResolvedValue(undefined);
const runAssetEpochCheck = vi.fn().mockResolvedValue({ changed: false, resolved: false });
const runQuoteMaintenance = vi.fn().mockResolvedValue(undefined);
const cancelQuotesWhileStale = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/runtime/loops.js", () => ({
  cancelQuotesWhileStale,
  refreshPrivateState,
  runAggression,
  runAssetEpochCheck,
  runQuoteMaintenance,
}));

const { runCoordinatorStep } = await import("../src/runtime/coordinator.js");
const { STATE } = await import("../src/runtime/state.js");
const { RUNTIME_CFG } = await import("../src/runtime/context.js");

function asset(isResolved = false): Asset {
  return {
    assetId: 1n,
    epoch: 1n,
    registered: true,
    expiration: 1_700_000_900n,
    assetType: 2n,
    strikePrice: 500_000n,
    resolutionPrice: isResolved ? 600_000n : 0n,
    isResolved,
    ledger: "0xledger",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  STATE.asset = asset();
  STATE.epoch = 1n;
  // @ts-ignore
  RUNTIME_CFG.IS_TAKER = false;
  apiGetBook.mockReset();
  refreshPrivateState.mockClear();
  runAggression.mockClear();
  runAssetEpochCheck.mockClear();
  runQuoteMaintenance.mockClear();
  cancelQuotesWhileStale.mockClear();
  STATE.fairValue = null;
});

afterEach(() => {
  vi.useRealTimers();
});

function context() {
  return {
    wallet: {} as never,
    queue: new RuntimeEventQueue(),
    localBook: createLocalOrderBookState(1n),
    nextEpochCheck: 2_000_000_000_000,
    nextQuote: 0,
    nextAggression: 2_000_000_000_000,
    bookReady: true,
    assetReady: true,
  };
}

describe("coordinator step", () => {
  it("schedules a new quote pass immediately after refreshing an interrupted batch", async () => {
    STATE.oracle.stale = false;
    STATE.fairValue = {
      protocolPrice: 500_000,
      probability: 0.5,
      spot: 500_000n,
      strike: 500_000n,
      expiresInSec: 900,
      updatedAtMs: Date.now(),
    };
    runQuoteMaintenance.mockResolvedValueOnce("reprice");
    refreshPrivateState.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 250);
    });
    const stepContext = context();

    const promise = runCoordinatorStep(stepContext);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(runQuoteMaintenance).toHaveBeenCalledOnce();
    expect(refreshPrivateState).toHaveBeenCalledOnce();
    expect(stepContext.nextQuote).toBe(Date.now());
    expect(cancelQuotesWhileStale).not.toHaveBeenCalled();
  });

  it("cancels resting quotes when an active batch loses required pricing", async () => {
    STATE.oracle.stale = false;
    STATE.fairValue = {
      protocolPrice: 500_000,
      probability: 0.5,
      spot: 500_000n,
      strike: 500_000n,
      expiresInSec: 900,
      updatedAtMs: Date.now(),
    };
    runQuoteMaintenance.mockImplementationOnce(async () => {
      STATE.oracle.stale = true;
      STATE.fairValue = null;
      return "paused";
    });
    const stepContext = context();

    const promise = runCoordinatorStep(stepContext);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(cancelQuotesWhileStale).toHaveBeenCalledOnce();
    expect(refreshPrivateState).toHaveBeenCalledOnce();
    expect(stepContext.nextQuote).toBeGreaterThan(Date.now());
  });

  it("runs quote maintenance for an active asset", async () => {
    const promise = runCoordinatorStep(context());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(runQuoteMaintenance).toHaveBeenCalledOnce();
    expect(runAggression).not.toHaveBeenCalled();
  });

  it("cancels resting quotes while the reference price is stale", async () => {
    const promise = runCoordinatorStep(context());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(cancelQuotesWhileStale).toHaveBeenCalledOnce();
  });

  it("leaves quotes alone while the reference price is fresh", async () => {
    STATE.oracle.stale = false;
    STATE.fairValue = {
      protocolPrice: 500_000,
      probability: 0.5,
      spot: 1n,
      strike: 1n,
      expiresInSec: 60,
      updatedAtMs: Date.now(),
    };

    const promise = runCoordinatorStep(context());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(cancelQuotesWhileStale).not.toHaveBeenCalled();
  });

  it("does not run trading loops for a resolved asset", async () => {
    STATE.asset = asset(true);

    const promise = runCoordinatorStep(context());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(runQuoteMaintenance).not.toHaveBeenCalled();
    expect(runAggression).not.toHaveBeenCalled();
  });

  it("runs aggression but not quote maintenance in taker mode", async () => {
    // @ts-ignore
    RUNTIME_CFG.IS_TAKER = true;
    const takerContext = context();
    takerContext.nextQuote = 0;
    takerContext.nextAggression = 0;

    const promise = runCoordinatorStep(takerContext);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(runAggression).toHaveBeenCalledOnce();
    expect(runQuoteMaintenance).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "handles an oracle notification before the quote deadline with stale=%s",
    async (stale) => {
      STATE.oracle.stale = stale;
      STATE.fairValue = {
        protocolPrice: 500_000,
        probability: 0.5,
        spot: 500_000n,
        strike: 500_000n,
        expiresInSec: 900,
        updatedAtMs: Date.now(),
      };

      const stepContext = context();
      stepContext.nextQuote = Date.now() + 60_000;

      // Multiple notifications in one batch must produce at most one pass.
      stepContext.queue.publish({ type: "oracle-state-changed" });
      stepContext.queue.publish({ type: "oracle-state-changed" });

      await runCoordinatorStep(stepContext);

      expect(runQuoteMaintenance).toHaveBeenCalledTimes(stale ? 0 : 1);
      expect(refreshPrivateState).toHaveBeenCalledTimes(stale ? 0 : 1);
      expect(cancelQuotesWhileStale).toHaveBeenCalledTimes(stale ? 1 : 0);
      expect(runAggression).not.toHaveBeenCalled();
    },
  );
});
