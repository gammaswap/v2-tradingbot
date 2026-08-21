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
        getPosition: vi.fn().mockResolvedValue({ size: 0n }),
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
        expect(deps.getPosition).not.toHaveBeenCalled();
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
        deps.getPosition.mockResolvedValue({ size: 10n });
        const current = asset(5n);

        const result = await reconcileAssetEpoch(state, current, {} as never, deps);

        expect(result.changed).toBe(true);
        expect(deps.getPosition).toHaveBeenCalledWith(4n);
        expect(deps.claim).toHaveBeenCalledWith(expect.anything(), 4n);
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

    it("continues when position lookup or claim fails", async () => {
        const state = createInitialState();
        state.epoch = 4n;
        const deps = dependencies();
        deps.getPosition.mockRejectedValue(new Error("position unavailable"));
        deps.claim.mockRejectedValue(new Error("claim failed"));

        const result = await reconcileAssetEpoch(state, asset(5n), {} as never, deps);

        expect(result.changed).toBe(true);
        expect(state.epoch).toBe(5n);
    });
});
