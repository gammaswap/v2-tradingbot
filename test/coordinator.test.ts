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
vi.mock("../src/runtime/loops.js", () => ({
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
  RUNTIME_CFG.IS_TAKER = false;
  apiGetBook.mockReset();
  refreshPrivateState.mockClear();
  runAggression.mockClear();
  runAssetEpochCheck.mockClear();
  runQuoteMaintenance.mockClear();
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
  it("runs quote maintenance for an active asset", async () => {
    const promise = runCoordinatorStep(context());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(runQuoteMaintenance).toHaveBeenCalledOnce();
    expect(runAggression).not.toHaveBeenCalled();
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
});
