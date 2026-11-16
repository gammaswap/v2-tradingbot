import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZeroHash } from "ethers";
import type { ApiAssetResponse, PendingOrder } from "../src/utils/types.js";

const apiGetAsset = vi.fn();
const apiGetBalance = vi.fn();
const apiGetPending = vi.fn();
const apiGetPosition = vi.fn();
const apiGetClaimable = vi.fn();
const apiClaim = vi.fn();
const apiCancelOrder = vi.fn();
const apiSendOrder = vi.fn();
const apiCancelReplaceOrder = vi.fn();

vi.mock("../src/api/api.js", () => ({
  apiGetAsset,
  apiGetBalance,
  apiGetPending,
  apiGetPosition,
  apiGetClaimable,
  apiClaim,
  apiCancelOrder,
  apiSendOrder,
  apiCancelReplaceOrder,
}));

const { STATE } = await import("../src/runtime/state.js");
const {
  cancelAllOrders,
  cancelAllOpenOrdersOnShutdown,
  cancelQuotesWhileStale,
  reconcileOrderIntents,
  runAssetEpochCheck,
  runAggression,
  runQuoteMaintenance,
} = await import("../src/runtime/loops.js");
const { ORDER_INTENTS } = await import("../src/runtime/orderIntent.js");
const { markFairValueStale, updateFairValueFromOracle } =
  await import("../src/runtime/fairValue.js");
const { createBotContext, runWithBotContext } = await import("../src/runtime/context.js");
const { getOrderKey } = await import("../src/utils/utils.js");

function asset(epoch: bigint, overrides: Partial<ApiAssetResponse> = {}): ApiAssetResponse {
  return {
    assetId: 123n,
    epoch,
    registered: true,
    expiration: 1_700_000_900n + epoch * 900n,
    assetType: 2n,
    strikePrice: 500_000n + epoch,
    resolutionPrice: 0n,
    isResolved: false,
    ledger: "0xledger",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  STATE.asset = asset(4n);
  STATE.epoch = 4n;
  STATE.book = {
    assetId: 123n,
    epoch: 4n,
    seqId: 1n,
    ts: 1n,
    bids: [],
    asks: [],
  };
  STATE.fairValue = null;
  STATE.quoteModel = null;
  STATE.oracle.price = null;
  apiGetAsset.mockReset();
  apiGetBalance.mockReset();
  apiGetPending.mockReset();
  apiGetPosition.mockReset();
  apiGetClaimable.mockReset();
  apiClaim.mockReset();
  apiCancelOrder.mockReset();
  apiSendOrder.mockReset();
  apiCancelReplaceOrder.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("asset epoch lifecycle", () => {
  it.each([false, true])(
    "preserves oracle freshness across an epoch change with stale=%s",
    async (stale) => {
      const receivedAtMs = 1_700_000_000_000;
      vi.setSystemTime(receivedAtMs);
      updateFairValueFromOracle(500_500n, 1_700_000_000n);
      if (stale) markFairValueStale();
      vi.setSystemTime(receivedAtMs + 20_000);
      const oracleBefore = { ...STATE.oracle };
      apiGetAsset.mockResolvedValue(
        asset(5n, {
          strikePrice: 500_600n,
          expiration: 1_700_001_800n,
        }),
      );
      apiGetClaimable.mockResolvedValue({ claimable: 0n });
      apiGetPending.mockResolvedValue({ buys: [], sells: [] });

      const result = await runAssetEpochCheck({} as never);

      expect(result.changed).toBe(true);
      expect(STATE.epoch).toBe(5n);
      expect(STATE.oracle).toEqual(oracleBefore);
      if (stale) {
        expect(STATE.fairValue).toBeNull();
      } else {
        expect(STATE.fairValue).toMatchObject({
          strike: 500_600n,
          expiresInSec: 1_780,
          updatedAtMs: receivedAtMs,
        });
      }
    },
  );

  it("refreshes the current asset without deriving values from resolution", async () => {
    const current = asset(4n, {
      strikePrice: 612_345n,
      expiration: 1_700_123_456n,
      resolutionPrice: 0n,
      isResolved: false,
    });
    apiGetAsset.mockResolvedValue(current);

    const result = await runAssetEpochCheck({} as never);

    expect(result).toEqual({ changed: false, resolved: false });
    expect(STATE.asset).toBe(current);
    expect(STATE.asset?.strikePrice).toBe(612_345n);
    expect(STATE.asset?.expiration).toBe(1_700_123_456n);
    expect(apiClaim).not.toHaveBeenCalled();
  });

  it("moves to the API-provided next epoch and claims the previous position", async () => {
    apiGetAsset.mockResolvedValue(
      asset(5n, {
        strikePrice: 700_000n,
        expiration: 1_700_005_400n,
      }),
    );
    apiGetClaimable.mockResolvedValue({ claimable: 1n });
    apiGetPending.mockResolvedValue({ buys: [], sells: [] });

    const promise = runAssetEpochCheck({} as never);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ changed: true, resolved: false });
    expect(apiClaim).toHaveBeenCalledWith(expect.anything(), 4n);
    expect(STATE.epoch).toBe(5n);
    expect(STATE.asset?.strikePrice).toBe(700_000n);
  });

  it("advances the epoch while another asset on the account holds pending balance", async () => {
    apiGetAsset.mockResolvedValue(asset(5n));
    apiGetClaimable.mockResolvedValue({ claimable: 0n });
    apiGetBalance.mockResolvedValue({ pending: 50_000_000n });
    apiGetPending.mockResolvedValue({ buys: [], sells: [] });

    const promise = runAssetEpochCheck({} as never);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ changed: true, resolved: false });
    expect(apiGetPending).toHaveBeenCalledWith(expect.any(String), 4n);
    expect(apiCancelOrder).not.toHaveBeenCalled();
    expect(STATE.epoch).toBe(5n);
  });

  it("cancels before advancing when this asset still has resting orders", async () => {
    apiGetAsset.mockResolvedValue(asset(5n));
    apiGetClaimable.mockResolvedValue({ claimable: 0n });
    apiGetBalance.mockResolvedValue({ pending: 0n });
    apiGetPending
      .mockResolvedValueOnce({ buys: [{ id: "order" }], sells: [] })
      .mockResolvedValue({ buys: [], sells: [] });

    const promise = runAssetEpochCheck({} as never);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ changed: false, resolved: false });
    expect(STATE.epoch).toBe(4n);
  });

  it("marks a resolved current epoch as resolved even when its price is zero", async () => {
    apiGetAsset.mockResolvedValue(
      asset(4n, {
        resolutionPrice: 0n,
        isResolved: true,
      }),
    );

    const result = await runAssetEpochCheck({} as never);

    expect(result).toEqual({ changed: false, resolved: true });
    expect(STATE.asset?.isResolved).toBe(true);
  });
});

describe("graceful shutdown order cancellation", () => {
  it("returns without scanning epochs when pending balance is below dust", async () => {
    apiGetBalance.mockResolvedValue({ pending: 0n });

    await cancelAllOpenOrdersOnShutdown({} as never, 2n);

    expect(apiGetBalance).toHaveBeenCalledOnce();
    expect(apiGetPending).not.toHaveBeenCalled();
    expect(apiCancelOrder).not.toHaveBeenCalled();
  });

  it("rechecks pending orders after submitting cancel-all", async () => {
    apiGetBalance
      .mockResolvedValueOnce({ pending: 2_000_000n })
      .mockResolvedValueOnce({ pending: 0n });
    apiGetPending
      .mockResolvedValueOnce({ buys: [{ id: "order" }], sells: [] })
      .mockResolvedValue({ buys: [], sells: [] });

    const promise = cancelAllOpenOrdersOnShutdown({} as never, 0n);
    await vi.runAllTimersAsync();
    await promise;

    expect(apiCancelOrder).toHaveBeenCalledWith(expect.anything(), 0n, expect.any(String));
    expect(apiGetPending).toHaveBeenCalledTimes(2);
    expect(apiGetBalance).toHaveBeenCalledTimes(2);
  });
});

describe("stale reference price", () => {
  const emptyPending = { buys: [], sells: [] };
  const openPending = { buys: [{ id: "open-order" }], sells: [] };

  async function cancelAndAdvanceTimers() {
    const promise = cancelQuotesWhileStale({} as never);
    await vi.runAllTimersAsync();
    await promise;
  }

  it("cancels resting quotes when quote maintenance pauses", async () => {
    apiGetPending.mockResolvedValue(openPending);

    const promise = runQuoteMaintenance({} as never);
    await vi.runAllTimersAsync();
    await promise;

    expect(apiGetPending).toHaveBeenCalledWith(STATE.account, 4n);
    expect(apiCancelOrder).toHaveBeenCalledOnce();
    expect(apiCancelOrder).toHaveBeenCalledWith(expect.anything(), 4n, ZeroHash);
    expect(apiSendOrder).not.toHaveBeenCalled();
    expect(apiCancelReplaceOrder).not.toHaveBeenCalled();
  });

  it.each(["buys", "sells"] as const)(
    "keeps cancelling while pending %s remain, including after an epoch change",
    async (side) => {
      apiGetPending.mockResolvedValue({ ...emptyPending, [side]: [{ id: "open-order" }] });

      await cancelAndAdvanceTimers();
      await cancelAndAdvanceTimers();
      expect(apiGetPending).toHaveBeenCalledTimes(2);
      expect(apiCancelOrder).toHaveBeenCalledTimes(2);

      STATE.epoch = 5n;
      await cancelAndAdvanceTimers();
      expect(apiGetPending).toHaveBeenLastCalledWith(STATE.account, 5n);
      expect(apiCancelOrder).toHaveBeenCalledTimes(3);
      expect(apiCancelOrder).toHaveBeenLastCalledWith(expect.anything(), 5n, ZeroHash);
    },
  );

  it("skips cancellation when empty but cancels orders appearing later in the same epoch", async () => {
    apiGetPending
      .mockResolvedValueOnce(openPending)
      .mockResolvedValueOnce(emptyPending)
      .mockResolvedValueOnce(openPending);

    await cancelAndAdvanceTimers();
    expect(apiCancelOrder).toHaveBeenCalledTimes(1);
    await cancelAndAdvanceTimers();
    expect(apiCancelOrder).toHaveBeenCalledTimes(1);
    await cancelAndAdvanceTimers();
    expect(apiCancelOrder).toHaveBeenCalledTimes(2);
    expect(apiGetPending).toHaveBeenCalledTimes(3);
  });

  it("throttles checks even when there are no pending orders", async () => {
    apiGetPending.mockResolvedValue(emptyPending);
    let finished = false;
    const promise = cancelQuotesWhileStale({} as never).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(finished).toBe(false);
    expect(apiCancelOrder).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(finished).toBe(true);
  });

  it("retries a failed cancel on the next call while orders remain", async () => {
    apiGetPending.mockResolvedValue(openPending);
    apiCancelOrder.mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);

    await cancelAndAdvanceTimers();
    expect(apiCancelOrder).toHaveBeenCalledTimes(1);
    await cancelAndAdvanceTimers();
    expect(apiGetPending).toHaveBeenCalledTimes(2);
    expect(apiCancelOrder).toHaveBeenCalledTimes(2);
  });

  it("throttles a failed pending lookup and checks again on the next call", async () => {
    apiGetPending
      .mockRejectedValueOnce(new Error("lookup unavailable"))
      .mockResolvedValue(openPending);
    let finished = false;
    const promise = cancelQuotesWhileStale({} as never).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(finished).toBe(false);
    expect(apiCancelOrder).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(finished).toBe(true);

    await cancelAndAdvanceTimers();
    expect(apiGetPending).toHaveBeenCalledTimes(2);
    expect(apiCancelOrder).toHaveBeenCalledOnce();
  });
});

describe("cancel scan bounds", () => {
  const scannedEpochs = () => apiGetPending.mock.calls.map(([, epoch]) => epoch);

  it("stops the shutdown scan at the lookback when account pending never clears", async () => {
    STATE.epoch = 100n;
    apiGetBalance.mockResolvedValue({ pending: 50_000_000n });
    apiGetPending.mockResolvedValue({ buys: [], sells: [] });

    const promise = cancelAllOpenOrdersOnShutdown({} as never, 100n);
    await vi.runAllTimersAsync();
    await promise;

    expect(scannedEpochs()).toEqual([100n, 99n, 98n, 97n]);
  });

  it("stops cancelAllOrders at the lookback when account pending never clears", async () => {
    STATE.epoch = 100n;
    apiGetBalance.mockResolvedValue({ pending: 50_000_000n });
    apiGetPending.mockResolvedValue({ buys: [], sells: [] });

    const promise = cancelAllOrders({} as never);
    await vi.runAllTimersAsync();
    await promise;

    expect(scannedEpochs()).toEqual([100n, 99n, 98n, 97n]);
  });

  it("still reaches the bot's own epoch when starting from a newer one", async () => {
    STATE.epoch = 90n;
    apiGetBalance.mockResolvedValue({ pending: 50_000_000n });
    apiGetPending.mockResolvedValue({ buys: [], sells: [] });

    const promise = cancelAllOrders({} as never, 100n);
    await vi.runAllTimersAsync();
    await promise;

    expect(scannedEpochs()[0]).toBe(100n);
    expect(scannedEpochs().at(-1)).toBe(87n);
    expect(scannedEpochs()).toContain(90n);
  });
});

describe("resolved-epoch trading guards", () => {
  it("does not quote a resolved asset", async () => {
    STATE.asset = asset(4n, { isResolved: true, resolutionPrice: 600_000n });

    await runQuoteMaintenance({} as never);

    expect(apiSendOrder).not.toHaveBeenCalled();
  });

  it("does not aggress on a resolved asset", async () => {
    STATE.asset = asset(4n, { isResolved: true, resolutionPrice: 600_000n });

    await runAggression({} as never);

    expect(apiSendOrder).not.toHaveBeenCalled();
  });
});

describe("active quote batches", () => {
  let botContext: ReturnType<typeof createBotContext>;
  const wallet = { address: "0xwallet" } as never;
  const accepted = { request: { orderHash: "0xaccepted" }, data: { status: "ACCEPTED" } };
  const replaced = { request: { orderHash: "0xreplacement" }, data: { status: "SUCCESS" } };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  }

  function setFairValue(protocolPrice: number) {
    botContext.state.oracle.stale = false;
    botContext.state.fairValue = {
      protocolPrice,
      probability: protocolPrice / 1_000_000,
      spot: 500_000n,
      strike: 500_000n,
      expiresInSec: 900,
      updatedAtMs: Date.now(),
    };
  }

  function addPendingBuy(id: string, price: number, size = 5_000_000) {
    const order: PendingOrder = {
      id,
      price,
      size,
      side: "buy",
      time: Date.now(),
      epoch: 4n,
      account: "0xwallet",
    };
    botContext.state.pending.set(id, order);
    botContext.state.pendingBuys.set(getOrderKey(order), order);
  }

  const runBatch = () => runWithBotContext(botContext, () => runQuoteMaintenance(wallet));

  beforeEach(() => {
    vi.setSystemTime(1_700_000_000_000);
    botContext = createBotContext({
      ASSET_ID: "123",
      IS_TAKER: false,
      USE_ORACLE_FAIR_VALUE: true,
      REQUIRE_FRESH_FAIR_VALUE: true,
      FAIR_VALUE_WEIGHT: 1,
      LEVELS_PER_SIDE: 2,
      LADDER_PRICE_MODEL: 1,
      BASE_RESERVE_MIN: 0,
      MAX_CAPITAL_EXPOSURE_PERCENT: 100,
      MAX_CONTRACT_EXPOSURE_PCT: 5,
    });
    Object.assign(botContext.state, {
      asset: asset(4n, { strikePrice: 500_000n, expiration: 1_700_000_900n }),
      epoch: 4n,
      periodLength: 900,
      book: { assetId: 123n, epoch: 4n, seqId: 1n, ts: 1n, bids: [], asks: [] },
      account: "0xwallet",
      accountBalance: 1_000_000_000,
      baseBal: 1_000_000_000,
    });
    setFairValue(500_000);
    apiGetPending.mockImplementation(() =>
      Promise.resolve({
        epoch: 4n,
        buys: Array.from(botContext.state.pendingBuys.values()),
        sells: Array.from(botContext.state.pendingSells.values()),
      }),
    );
    apiSendOrder.mockResolvedValue(accepted);
    apiCancelReplaceOrder.mockResolvedValue(replaced);
  });

  it.each(["place", "cancel-replace"] as const)(
    "settles every concurrent %s submission before requesting a reprice",
    async (kind) => {
      if (kind === "cancel-replace") {
        addPendingBuy("old-buy-1", 300_000);
        addPendingBuy("old-buy-2", 200_000);
      }
      const count = kind === "place" ? 4 : 2;
      const responses = Array.from({ length: count }, () => deferred<typeof accepted>());
      const allStarted = deferred<void>();
      const submit = kind === "place" ? apiSendOrder : apiCancelReplaceOrder;
      let submitted = 0;
      submit.mockImplementation(() => {
        const response = responses[submitted++];
        if (submitted === count) allStarted.resolve();
        return response.promise;
      });

      let finished = false;
      const batch = runBatch().then((result) => {
        finished = true;
        return result;
      });

      // Every request must start before any response is released.
      await allStarted.promise;
      expect(submit).toHaveBeenCalledTimes(count);
      const intents = botContext.orderIntents.getOutstanding(kind);
      expect(intents).toHaveLength(count);
      expect(intents.every((intent) => intent.status === "attempted")).toBe(true);
      expect(new Set(intents.map((intent) => intent.nonce)).size).toBe(count);
      setFairValue(600_000);

      // Complete the last request first.
      responses[count - 1].resolve(kind === "place" ? accepted : replaced);
      await vi.advanceTimersByTimeAsync(0);
      expect(intents[count - 1].status).toBe("completed");
      expect(intents[count - 1].requestHash).toBe(
        kind === "place" ? "0xaccepted" : "0xreplacement",
      );
      expect(intents[0].status).toBe("attempted");
      expect(finished).toBe(false);

      for (const response of responses.slice(0, -1)) {
        response.resolve(kind === "place" ? accepted : replaced);
      }
      expect(await batch).toBe("reprice");
      expect(kind === "place" ? apiCancelReplaceOrder : apiSendOrder).not.toHaveBeenCalled();
      expect(intents.every((intent) => intent.status === "completed")).toBe(true);
      expect(botContext.orderIntents.getOutstanding()).toEqual([]);
    },
  );

  it("continues the batch when target movement stays within one tick", async () => {
    const response = deferred<typeof accepted>();
    const started = deferred<void>();
    apiSendOrder.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });

    const batch = runBatch();
    await started.promise;
    setFairValue(501_000);
    response.resolve(accepted);

    expect(await batch).toBeUndefined();
    expect(apiSendOrder).toHaveBeenCalledTimes(4);
  });

  it("pauses before placements when pricing becomes unavailable during replacements", async () => {
    addPendingBuy("old-buy-1", 300_000);
    addPendingBuy("old-buy-2", 200_000);
    const response = deferred<typeof replaced>();
    const started = deferred<void>();
    apiCancelReplaceOrder.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });

    const batch = runBatch();
    await started.promise;
    const intent = botContext.orderIntents.getOutstanding("cancel-replace")[0];
    runWithBotContext(botContext, markFairValueStale);
    response.resolve(replaced);

    expect(await batch).toBe("paused");
    expect(apiCancelReplaceOrder).toHaveBeenCalledTimes(2);
    expect(apiSendOrder).not.toHaveBeenCalled();
    expect(intent.status).toBe("completed");
  });

  it("rechecks pricing after initial intent reconciliation", async () => {
    addPendingBuy("old-buy", 300_000);
    botContext.orderIntents.getOrCreate({
      kind: "cancel-replace",
      assetId: "123",
      epoch: 4n,
      slot: "buy:450000",
      targetOrderHash: "old-buy",
      side: "buy",
      price: 450_000,
      size: 5_000_000,
    });
    const pending = deferred<{ epoch: bigint; buys: PendingOrder[]; sells: PendingOrder[] }>();
    const started = deferred<void>();
    apiGetPending.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });

    const batch = runBatch();
    await started.promise;
    runWithBotContext(botContext, markFairValueStale);
    pending.resolve({
      epoch: 4n,
      buys: Array.from(botContext.state.pendingBuys.values()) as PendingOrder[],
      sells: [],
    });

    expect(await batch).toBe("paused");
    expect(apiSendOrder).not.toHaveBeenCalled();
    expect(apiCancelReplaceOrder).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "settles concurrent cancellations before verification (failure=%s)",
    async (failure) => {
      const hashes = ["0xcancel-first", "0xcancel-second"];
      const intents = hashes.map((hash) =>
        botContext.orderIntents.getOrCreate({
          kind: "cancel",
          assetId: "123",
          epoch: 4n,
          slot: hash,
          targetOrderHash: hash,
        }),
      );
      const firstNonce = intents[0].nonce;
      const first = deferred<{ request: { orderHash: string } }>();
      const second = deferred<{ data: { status: string } }>();
      const bothStarted = deferred<void>();

      apiGetPending
        .mockResolvedValueOnce({
          epoch: 4n,
          buys: hashes.map((id) => ({ id })),
          sells: [],
        })
        .mockResolvedValueOnce({
          epoch: 4n,
          buys: failure ? [{ id: hashes[0] }] : [],
          sells: [],
        });

      apiCancelOrder
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => {
          bothStarted.resolve();
          return second.promise;
        });

      const reconciliation = runWithBotContext(botContext, () => reconcileOrderIntents(wallet));

      // Both requests start while the first response is still pending.
      await bothStarted.promise;
      expect(apiCancelOrder.mock.calls).toEqual(
        intents.map((intent, i) => [wallet, 4n, hashes[i], intent.nonce]),
      );

      second.resolve({ data: { status: "CANCELLED" } });
      await vi.advanceTimersByTimeAsync(0);

      expect(intents[1].status).toBe("completed");
      expect(intents[0].status).toBe("attempted");
      expect(apiGetPending).toHaveBeenCalledTimes(1);

      if (failure) {
        first.reject(new Error("network"));
      } else {
        first.resolve({ request: { orderHash: "0xcancel-request" } });
      }

      expect(await reconciliation).toBe(!failure);
      expect(apiGetPending).toHaveBeenCalledTimes(2);
      expect(intents[0].nonce).toBe(firstNonce);
      expect(intents[0].status).toBe(failure ? "unknown" : "completed");
      expect(botContext.orderIntents.getOutstanding("cancel")).toEqual(failure ? [intents[0]] : []);
    },
  );

  it("rechecks targets after cancellation reconciliation", async () => {
    Object.assign(botContext.config, { LEVELS_PER_SIDE: 1 });
    addPendingBuy("keep-buy", 500_000, 50_000_000);
    addPendingBuy("cancel-buy", 300_000);
    const response = deferred<{ data: { status: string } }>();
    const started = deferred<void>();
    apiCancelOrder.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });

    const batch = runBatch();
    await started.promise;
    setFairValue(600_000);
    response.resolve({ data: { status: "CANCELLED" } });

    expect(await batch).toBe("reprice");
    expect(apiCancelOrder).toHaveBeenCalledOnce();
    expect(apiSendOrder).not.toHaveBeenCalled();
  });

  it("retains an unknown request when its response fails during a price move", async () => {
    addPendingBuy("old-buy-1", 300_000);
    addPendingBuy("old-buy-2", 200_000);
    const response = deferred<typeof replaced>();
    const remainingResponse = deferred<typeof replaced>();
    const started = deferred<void>();
    apiCancelReplaceOrder
      .mockImplementationOnce(() => {
        started.resolve();
        return response.promise;
      })
      .mockImplementationOnce(() => remainingResponse.promise);

    let finished = false;
    const batch = runBatch().then((result) => {
      finished = true;
      return result;
    });
    await started.promise;
    const intent = botContext.orderIntents.getOutstanding("cancel-replace")[0];
    const nonce = intent.nonce;
    setFairValue(600_000);
    response.reject(new Error("network"));
    await vi.advanceTimersByTimeAsync(0);
    expect(intent.status).toBe("unknown");
    expect(finished).toBe(false);
    expect(botContext.orderIntents.getOutstanding("cancel-replace")[1].status).toBe("attempted");
    remainingResponse.resolve(replaced);

    expect(await batch).toBe("reprice");
    expect(intent.status).toBe("unknown");
    expect(intent.nonce).toBe(nonce);
    expect(botContext.orderIntents.getOutstanding()).toEqual([intent]);
    expect(apiCancelReplaceOrder).toHaveBeenCalledTimes(2);
    expect(apiSendOrder).not.toHaveBeenCalled();
  });

  it.each(["place", "cancel-replace"] as const)(
    "does not reuse a conflicting unknown %s intent",
    async (kind) => {
      if (kind === "cancel-replace") addPendingBuy("old-buy", 300_000);
      const intent = botContext.orderIntents.getOrCreate(
        kind === "place"
          ? {
              kind,
              assetId: "123",
              epoch: 4n,
              slot: "buy:500000",
              side: "buy",
              price: 500_000,
              size: 1_000_000,
              timeInForce: 3n,
            }
          : {
              kind,
              assetId: "123",
              epoch: 4n,
              slot: "buy:450000",
              side: "buy",
              price: 450_000,
              size: 1_000_000,
              targetOrderHash: "old-buy",
            },
      );
      botContext.orderIntents.markAttempted(intent);
      botContext.orderIntents.markUnknown(intent);
      await vi.advanceTimersByTimeAsync(1_000);
      const nonce = intent.nonce;

      await runBatch();

      const submit = kind === "place" ? apiSendOrder : apiCancelReplaceOrder;
      expect(submit.mock.calls.some(([, order]) => order.nonce === nonce)).toBe(false);
      expect(intent.nonce).toBe(nonce);
      expect(intent.status).toBe("unknown");
      expect(botContext.orderIntents.getOutstanding()).toContain(intent);
    },
  );
});

describe("order intent reconciliation", () => {
  it("retries a pending cancellation with its original nonce and waits for it to disappear", async () => {
    const orderHash = "0xpending-cancel-test";
    const intent = ORDER_INTENTS.getOrCreate({
      kind: "cancel",
      assetId: "123",
      epoch: 4n,
      slot: `cancel-${orderHash}`,
      targetOrderHash: orderHash,
    });
    apiCancelOrder.mockResolvedValue({ request: { orderHash: "0xcancel" } });
    apiGetPending
      .mockResolvedValueOnce({ epoch: 4n, buys: [{ id: orderHash }], sells: [] })
      .mockResolvedValueOnce({ epoch: 4n, buys: [], sells: [] });

    const ready = await reconcileOrderIntents({ address: "0xwallet" } as never);

    expect(ready).toBe(true);
    expect(apiCancelOrder).toHaveBeenCalledWith(expect.anything(), 4n, orderHash, intent.nonce);
    expect(ORDER_INTENTS.getOutstanding("cancel")).not.toContainEqual(intent);
  });

  it("blocks new orders while a cancellation target remains pending", async () => {
    const orderHash = "0xstill-pending-cancel-test";
    ORDER_INTENTS.getOrCreate({
      kind: "cancel",
      assetId: "123",
      epoch: 4n,
      slot: `cancel-${orderHash}`,
      targetOrderHash: orderHash,
    });
    apiCancelOrder.mockResolvedValue({ request: { orderHash: "0xcancel" } });
    apiGetPending.mockResolvedValue({ epoch: 4n, buys: [{ id: orderHash }], sells: [] });

    await expect(reconcileOrderIntents({ address: "0xwallet" } as never)).resolves.toBe(false);
  });
});
