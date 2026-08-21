import type { Wallet } from "ethers";
import type { ApiAssetResponse, ApiPositionResponse, AssetEpochCheckResult } from "../utils/types.js";
import type { RuntimeState } from "./state.js";

export type AssetLifecycleDependencies = {
    getPosition(epoch: bigint): Promise<ApiPositionResponse>;
    claim(wallet: Wallet, epoch: bigint): Promise<unknown>;
    hasPendingOrders(): Promise<boolean>;
    cancelAllOrders(wallet: Wallet): Promise<void>;
    refreshFairValue(): void;
    markResolved(): void;
};

export async function reconcileAssetEpoch(
    state: RuntimeState,
    currentAsset: ApiAssetResponse,
    wallet: Wallet,
    deps: AssetLifecycleDependencies,
): Promise<AssetEpochCheckResult> {
    if (currentAsset.epoch === state.epoch) {
        state.asset = currentAsset;
        if (currentAsset.isResolved) deps.markResolved();
        return { changed: false, resolved: currentAsset.isResolved };
    }

    const previousEpoch = state.epoch;
    let position: ApiPositionResponse | null = null;
    try {
        position = await deps.getPosition(previousEpoch);
    } catch {
        // A position lookup failure should not prevent the bot from cleaning
        // up orders and observing the next asset epoch.
    }
    if (position && position.size > 0n) {
        try {
            await deps.claim(wallet, previousEpoch);
        } catch {
            // Preserve the previous runtime behavior: claim failures are
            // logged by the caller and do not block epoch reconciliation.
        }
    }

    if (await deps.hasPendingOrders()) {
        await deps.cancelAllOrders(wallet);
        return { changed: false, resolved: currentAsset.isResolved };
    }

    state.epoch = currentAsset.epoch;
    state.asset = currentAsset;
    deps.refreshFairValue();
    return { changed: true, resolved: currentAsset.isResolved };
}
