import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../src/runtime/state.js";
import { reconcileAssetEpoch } from "../src/runtime/assetLifecycle.js";
import type { ApiAssetResponse } from "../src/utils/types.js";

function asset(epoch: bigint, resolved = false): ApiAssetResponse {
    return {
        assetId: 1n,
        epoch,
        registered: true,
        expiration: 1_700_000_000n + epoch * 900n,
        assetType: 2n,
        strikePrice: 500_000n + epoch,
        resolutionPrice: resolved ? 600_000n : 0n,
        isResolved: resolved,
        ledger: "0xledger",
    };
}

function dependencies() {
    return {
        getClaimable: vi.fn().mockResolvedValue(0n),
        claim: vi.fn().mockResolvedValue(undefined),
        hasPendingOrders: vi.fn().mockResolvedValue(false),
        cancelAllOrders: vi.fn().mockResolvedValue(undefined),
        refreshFairValue: vi.fn(),
        markResolved: vi.fn(),
    };
}

describe("asset lifecycle reconciliation", () => {
    it("refreshes an unchanged active epoch", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        const current = asset(4n);

        const result = await reconcileAssetEpoch(state, current, {} as never, deps);

        expect(result).toEqual({ changed: false, resolved: false });
        expect(state.asset).toBe(current);
    });

    it("marks an unchanged resolved epoch without using resolutionPrice as the status", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        const current = asset(4n, true);
        current.resolutionPrice = 0n;

        const result = await reconcileAssetEpoch(state, current, {} as never, deps);

        expect(result.resolved).toBe(true);
        expect(deps.markResolved).toHaveBeenCalledOnce();
    });

    it("claims the previous position and advances to the API-provided epoch", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        deps.getClaimable.mockResolvedValue(1n);
        const current = asset(5n);

        const result = await reconcileAssetEpoch(state, current, {} as never, deps);

        expect(result.changed).toBe(true);
        expect(deps.claim).toHaveBeenCalledWith(expect.anything(), 4n);
        expect(deps.getClaimable).toHaveBeenCalledWith(4n);
        expect(state.epoch).toBe(5n);
        expect(state.asset?.strikePrice).toBe(current.strikePrice);
        expect(state.asset?.expiration).toBe(current.expiration);
        expect(deps.refreshFairValue).toHaveBeenCalledOnce();
    });

    it("does not advance while pending orders require cleanup", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        deps.hasPendingOrders.mockResolvedValue(true);

        const result = await reconcileAssetEpoch(state, asset(5n), {} as never, deps);

        expect(result.changed).toBe(false);
        expect(state.epoch).toBe(4n);
        expect(deps.cancelAllOrders).toHaveBeenCalledOnce();
    });

    it("skips a losing position when the claimable amount is zero", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();

        const result = await reconcileAssetEpoch(state, asset(5n), {} as never, deps);

        expect(result.changed).toBe(true);
        expect(state.epoch).toBe(5n);
        expect(deps.claim).not.toHaveBeenCalled();
    });

    it("continues when claimability lookup fails", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        deps.getClaimable.mockRejectedValue(new Error("claimability unavailable"));

        const result = await reconcileAssetEpoch(state, asset(5n), {} as never, deps);

        expect(result.changed).toBe(true);
        expect(state.epoch).toBe(5n);
    });
});
