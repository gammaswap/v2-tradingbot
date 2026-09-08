import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiAssetResponse } from "../src/utils/types.js";

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
    cancelAllOpenOrdersOnShutdown,
    reconcileOrderIntents,
    runAssetEpochCheck,
    runAggression,
    runQuoteMaintenance,
} = await import("../src/runtime/loops.js");
const { ORDER_INTENTS } = await import("../src/runtime/orderIntent.js");

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
        apiGetAsset.mockResolvedValue(asset(5n, {
            strikePrice: 700_000n,
            expiration: 1_700_005_400n,
        }));
        apiGetClaimable.mockResolvedValue({ claimable: 1n });
        apiGetBalance.mockResolvedValue({ pending: 0n });

        const promise = runAssetEpochCheck({} as never);
        await vi.advanceTimersByTimeAsync(2_000);
        const result = await promise;

        expect(result).toEqual({ changed: true, resolved: false });
        expect(apiClaim).toHaveBeenCalledWith(expect.anything(), 4n);
        expect(STATE.epoch).toBe(5n);
        expect(STATE.asset?.strikePrice).toBe(700_000n);
    });

    it("marks a resolved current epoch as resolved even when its price is zero", async () => {
        apiGetAsset.mockResolvedValue(asset(4n, {
            resolutionPrice: 0n,
            isResolved: true,
        }));

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
