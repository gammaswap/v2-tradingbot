import type { Wallet } from "ethers";
import type { ApiAssetResponse, ApiPositionResponse, AssetEpochCheckResult } from "../utils/types.js";
import { initializePeriodLength, type RuntimeState } from "./state.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("reconciliation");

export type AssetLifecycleDependencies = {
    getPosition(epoch: bigint): Promise<ApiPositionResponse>;
    getClaimable(epoch: bigint): Promise<bigint>;
    claim(wallet: Wallet, epoch: bigint): Promise<unknown>;
    hasPendingOrders(): Promise<boolean>;
    cancelAllOrders(wallet: Wallet, startingEpoch?: bigint): Promise<void>;
    refreshFairValue(): void;
    markResolved(): void;
};

export async function reconcileAssetEpoch(
    state: RuntimeState,
    currentAsset: ApiAssetResponse,
    wallet: Wallet,
    deps: AssetLifecycleDependencies,
): Promise<AssetEpochCheckResult> {
    // Production startup initializes this cache. When present, verify that
    // later epoch responses still belong to the same market configuration.
    if (state.periodLength !== null) {
        initializePeriodLength(state, currentAsset.assetId);
    }

    if (currentAsset.epoch === state.epoch) {
        state.asset = currentAsset;
        if (currentAsset.isResolved) deps.markResolved();
        return { changed: false, resolved: currentAsset.isResolved };
    }

    if (currentAsset.epoch < state.epoch) {
        return { changed: false, resolved: state.asset?.isResolved ?? false };
    }

    const previousEpoch = state.epoch;
    for (let epoch = previousEpoch; epoch < currentAsset.epoch; epoch++) {
        let position: ApiPositionResponse | null = null;
        try {
            position = await deps.getPosition(epoch);
        } catch {
            // A position lookup failure should not prevent observing the next
            // asset epoch.
        }
        if (position && position.size > 0n) {
            try {
                const claimable = await deps.getClaimable(epoch);
                if (claimable > 0n) {
                    await deps.claim(wallet, epoch);
                }
            } catch (e: any) {
                // Claimability and claim failures do not block observing the
                // next epoch. A later reconciliation or restart can retry.
                logger.warn("Exception while claiming:", e);
            }
        }
    }

    if (await deps.hasPendingOrders()) {
        await deps.cancelAllOrders(wallet, currentAsset.epoch);
        return { changed: false, resolved: currentAsset.isResolved };
    }

    state.epoch = currentAsset.epoch;
    state.asset = currentAsset;
    deps.refreshFairValue();
    return { changed: true, resolved: currentAsset.isResolved };
}
