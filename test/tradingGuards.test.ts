import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/runtime/state.js";
import { canTradeCurrentAsset } from "../src/runtime/tradingGuards.js";
import type { Asset } from "../src/utils/types.js";

function activeAsset(epoch: bigint, isResolved = false): Asset {
  return {
    assetId: 1n,
    epoch,
    registered: true,
    expiration: 1_700_000_000n,
    assetType: 2n,
    strikePrice: 500_000n,
    resolutionPrice: isResolved ? 600_000n : 0n,
    isResolved,
    ledger: "0xledger",
  };
}

describe("current asset trading guard", () => {
  it("rejects missing assets", () => {
    expect(canTradeCurrentAsset(createInitialState())).toBe(false);
  });

  it("rejects resolved assets", () => {
    const state = createInitialState();
    state.epoch = 4n;
    state.asset = activeAsset(4n, true);

    expect(canTradeCurrentAsset(state)).toBe(false);
  });

  it("rejects mismatched epochs", () => {
    const state = createInitialState();
    state.epoch = 4n;
    state.asset = activeAsset(3n);

    expect(canTradeCurrentAsset(state)).toBe(false);
  });

  it("accepts an active asset for the current epoch", () => {
    const state = createInitialState();
    state.epoch = 4n;
    state.asset = activeAsset(4n);

    expect(canTradeCurrentAsset(state)).toBe(true);
  });
});
