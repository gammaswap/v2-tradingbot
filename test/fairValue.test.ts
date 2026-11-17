import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeFairValueEstimate,
  markFairValueStale,
  refreshFairValueFromCachedOracle,
  updateFairValueFromOracle,
} from "../src/runtime/fairValue.js";
import { createBotContext, runWithBotContext } from "../src/runtime/context.js";
import { hasFreshFairValue } from "../src/runtime/strategy.js";
import type { Asset } from "../src/utils/types.js";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    assetId: 1n,
    epoch: 1n,
    registered: true,
    expiration: 1_700_000_900n,
    assetType: 2n,
    strikePrice: 500_000n,
    resolutionPrice: 0n,
    isResolved: false,
    ledger: "0xledger",
    ...overrides,
  };
}

describe("fair value calculations", () => {
  it("returns null for invalid spot or strike", () => {
    expect(computeFairValueEstimate(0n, asset())).toBeNull();
    expect(computeFairValueEstimate(500_000n, asset({ strikePrice: 0n }))).toBeNull();
  });

  it("gives a higher probability to a spot above the strike", () => {
    const below = computeFairValueEstimate(400_000n, asset(), 1_700_000_000_000);
    const above = computeFairValueEstimate(600_000n, asset(), 1_700_000_000_000);

    expect(above?.probability).toBeGreaterThan(below?.probability ?? 0);
    expect(above?.protocolPrice).toBeGreaterThan(below?.protocolPrice ?? 0);
  });

  it("returns a binary result after expiration", () => {
    const above = computeFairValueEstimate(
      600_000n,
      asset({ expiration: 1_700_000_000n }),
      1_700_000_000_000,
    );
    const below = computeFairValueEstimate(
      400_000n,
      asset({ expiration: 1_700_000_000n }),
      1_700_000_000_000,
    );

    expect(above?.probability).toBe(1);
    expect(below?.probability).toBe(0);
  });

  it("honors the configured expiration in the result", () => {
    const estimate = computeFairValueEstimate(
      500_000n,
      asset({ expiration: 1_700_001_000n }),
      1_700_000_000_000,
    );

    expect(estimate?.expiresInSec).toBe(1_000);
  });
});

describe("cached oracle fair-value recalculation", () => {
  const receivedAtMs = 1_700_000_000_000;
  let context: ReturnType<typeof createBotContext>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(receivedAtMs);
    context = createBotContext({ USE_ORACLE_FAIR_VALUE: true, FAIR_VALUE_STALE_MS: 45_000 });
    context.state.asset = asset();
    context.state.oracle.connected = true;
    runWithBotContext(context, () => updateFairValueFromOracle(500_500n, 1_700_000_000n));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the new asset and current time without renewing price freshness", () => {
    vi.setSystemTime(receivedAtMs + 20_000);
    context.state.epoch = 2n;
    context.state.asset = asset({
      epoch: 2n,
      strikePrice: 500_600n,
      expiration: 1_700_001_800n,
    });
    const oracleBefore = { ...context.state.oracle };

    runWithBotContext(context, () => {
      const estimate = refreshFairValueFromCachedOracle();
      const expected = computeFairValueEstimate(500_500n, context.state.asset!, Date.now());

      expect(estimate).toMatchObject({
        spot: 500_500n,
        strike: 500_600n,
        expiresInSec: 1_780,
        updatedAtMs: receivedAtMs,
        probability: expected?.probability,
      });
      expect(context.state.oracle).toEqual(oracleBefore);
      expect(hasFreshFairValue()).toBe(true);

      vi.setSystemTime(receivedAtMs + 45_001);
      expect(hasFreshFairValue()).toBe(false);
    });
  });

  it("keeps a stale cached price unavailable until a real price arrives", () => {
    runWithBotContext(context, () => {
      markFairValueStale();
      context.state.oracle.connected = false;
      vi.setSystemTime(receivedAtMs + 35_000);
      const oracleBefore = { ...context.state.oracle };

      expect(refreshFairValueFromCachedOracle()).toBeNull();
      expect(context.state.fairValue).toBeNull();
      expect(context.state.oracle).toEqual(oracleBefore);
      expect(hasFreshFairValue()).toBe(false);

      const estimate = updateFairValueFromOracle(501_000n, 1_700_000_035n);
      expect(estimate?.updatedAtMs).toBe(Date.now());
      expect(context.state.oracle.receivedAtMs).toBe(Date.now());
      expect(context.state.oracle.ts).toBe(1_700_000_035n);
      expect(context.state.oracle.stale).toBe(false);
      expect(hasFreshFairValue()).toBe(true);
    });
  });

  it("rejects an over-age price even before the stream is marked stale", () => {
    vi.setSystemTime(receivedAtMs + 45_001);
    const oracleBefore = { ...context.state.oracle };

    expect(runWithBotContext(context, refreshFairValueFromCachedOracle)).toBeNull();
    expect(context.state.fairValue).toBeNull();
    expect(context.state.oracle).toEqual(oracleBefore);
    expect(context.state.oracle.stale).toBe(false);
  });

  it("clears the previous estimate when the cached price is missing", () => {
    context.state.oracle.price = null;
    const oracleBefore = { ...context.state.oracle };

    expect(runWithBotContext(context, refreshFairValueFromCachedOracle)).toBeNull();
    expect(context.state.fairValue).toBeNull();
    expect(context.state.oracle).toEqual(oracleBefore);
  });
});
