import { afterEach, describe, expect, it } from "vitest";
import { CFG } from "../src/config/config.js";
import { STATE } from "../src/runtime/state.js";
import { encodeAssetId } from "../src/utils/assetIdUtils.js";
import type { Asset } from "../src/utils/types.js";
import {
  availableCollateral,
  buildEquidistantLadderPrices,
  buildGrowthSpaceLadderPrices,
  buildTargetLadderPrices,
  LADDER_PRICE_MODEL,
  capOrderSizeByMargin,
  calculateBidAndAsk,
  calculateCurrentRiskAversion,
  calculateInventorySkew,
  calculateTotalSizes,
  distributeTotalSizeAcrossLadder,
  hasFreshBook,
  hasUsableBookPrice,
  calculateRemainingEpochSeconds,
  calculateRiskAversionFactor,
} from "../src/runtime/strategy.js";

const originalBaseBal = STATE.baseBal;
const originalAccountBalance = STATE.accountBalance;
const originalReserve = CFG.BASE_RESERVE_MIN;
const originalExposurePercent = CFG.MAX_CAPITAL_EXPOSURE_PERCENT;
const originalPeriodLength = STATE.periodLength;
const originalBookUpdatedAtMs = STATE.bookUpdatedAtMs;
const originalLevelsPerSide = CFG.LEVELS_PER_SIDE;
const originalInventory = STATE.invBase;
const originalInventoryTarget = CFG.INV_TARGET;
const originalInventoryMaxAbs = CFG.INV_MAX_ABS;
const originalContractExposurePct = CFG.MAX_CONTRACT_EXPOSURE_PCT;
const originalDecayK = CFG.TOTAL_SIZE_DECAY_K;
const originalDecayA = CFG.TOTAL_SIZE_DECAY_A;
const originalTimeBucket = CFG.TOTAL_SIZE_TIME_BUCKET_SECONDS;
const originalQuoteSizeConcavity = CFG.QUOTE_SIZE_CONCAVITY;

afterEach(() => {
  STATE.baseBal = originalBaseBal;
  STATE.accountBalance = originalAccountBalance;
  (CFG as any).BASE_RESERVE_MIN = originalReserve;
  (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = originalExposurePercent;
  STATE.periodLength = originalPeriodLength;
  STATE.bookUpdatedAtMs = originalBookUpdatedAtMs;
  (CFG as any).LEVELS_PER_SIDE = originalLevelsPerSide;
  STATE.invBase = originalInventory;
  (CFG as any).INV_TARGET = originalInventoryTarget;
  (CFG as any).INV_MAX_ABS = originalInventoryMaxAbs;
  (CFG as any).MAX_CONTRACT_EXPOSURE_PCT = originalContractExposurePct;
  (CFG as any).TOTAL_SIZE_DECAY_K = originalDecayK;
  (CFG as any).TOTAL_SIZE_DECAY_A = originalDecayA;
  (CFG as any).TOTAL_SIZE_TIME_BUCKET_SECONDS = originalTimeBucket;
  (CFG as any).QUOTE_SIZE_CONCAVITY = originalQuoteSizeConcavity;
});

describe("target quote ladder prices", () => {
  it("builds sorted equidistant slots from calculated prices toward the book/reference bounds", () => {
    const originalLevels = CFG.LEVELS_PER_SIDE;
    (CFG as any).LEVELS_PER_SIDE = 3;
    const targets = buildEquidistantLadderPrices(
      {
        assetId: 1n,
        epoch: 1n,
        seqId: 1n,
        ts: 1n,
        bids: [{ price: 400_000, size: 1, orderCount: 1, orders: [] }],
        asks: [{ price: 600_000, size: 1, orderCount: 1, orders: [] }],
      },
      500_000,
      0.4,
      0.6,
    );

    expect(targets.bids).toEqual([500_000, 450_000, 400_000]);
    expect(targets.asks).toEqual([500_000, 550_000, 600_000]);
    (CFG as any).LEVELS_PER_SIDE = originalLevels;
  });

  it("uses the reference price for both ladder endpoints when the book is empty", () => {
    const originalLevels = CFG.LEVELS_PER_SIDE;
    (CFG as any).LEVELS_PER_SIDE = 3;
    const targets = buildEquidistantLadderPrices(
      {
        assetId: 1n,
        epoch: 1n,
        seqId: 1n,
        ts: 1n,
        bids: [],
        asks: [],
      },
      500_000,
      0.4,
      0.6,
    );

    expect(targets.bids).toEqual([500_000, 450_000, 400_000]);
    expect(targets.asks).toEqual([500_000, 550_000, 600_000]);
    (CFG as any).LEVELS_PER_SIDE = originalLevels;
  });

  it("filters calculated slots outside the hard range and marketable ALO prices", () => {
    const originalLevels = CFG.LEVELS_PER_SIDE;
    (CFG as any).LEVELS_PER_SIDE = 3;
    const targets = buildEquidistantLadderPrices(
      {
        assetId: 1n,
        epoch: 1n,
        seqId: 1n,
        ts: 1n,
        bids: [{ price: 200_000, size: 1, orderCount: 1, orders: [] }],
        asks: [{ price: 800_000, size: 1, orderCount: 1, orders: [] }],
      },
      500_000,
      0.05,
      0.95,
    );

    expect(targets.bids.every((price) => price >= CFG.HARD_MIN_PRICE)).toBe(true);
    expect(targets.asks.every((price) => price > 200_000)).toBe(true);
    expect(targets.asks.every((price) => price <= CFG.HARD_MAX_PRICE)).toBe(true);
    (CFG as any).LEVELS_PER_SIDE = originalLevels;
  });

  it("defaults the parent dispatcher to the equidistant model", () => {
    const book = {
      assetId: 1n,
      epoch: 1n,
      seqId: 1n,
      ts: 1n,
      bids: [{ price: 400_000, size: 1, orderCount: 1, orders: [] }],
      asks: [{ price: 600_000, size: 1, orderCount: 1, orders: [] }],
    };

    expect(buildTargetLadderPrices(book, 500_000, 0.4, 0.6)).toEqual(
      buildEquidistantLadderPrices(book, 500_000, 0.4, 0.6),
    );
  });

  it("uses the calculated bid/ask midpoint for the growth-space model", () => {
    const book = {
      assetId: 1n,
      epoch: 1n,
      seqId: 1n,
      ts: 1n,
      bids: [{ price: 400_000, size: 1, orderCount: 1, orders: [] }],
      asks: [{ price: 600_000, size: 1, orderCount: 1, orders: [] }],
    };
    const expected = buildGrowthSpaceLadderPrices(500_000, book);

    expect(
      buildTargetLadderPrices(book, 700_000, 0.4, 0.6, LADDER_PRICE_MODEL.GROWTH_SPACE),
    ).toEqual(expected);
  });

  it("does not clamp out-of-range levels to duplicate hard boundaries", () => {
    const belowRange = buildGrowthSpaceLadderPrices(0);
    const aboveRange = buildGrowthSpaceLadderPrices(1_000_000);

    expect(belowRange.bids).toEqual([]);
    expect(new Set(belowRange.asks).size).toBe(belowRange.asks.length);
    expect(aboveRange.asks).toEqual([]);
    expect(new Set(aboveRange.bids).size).toBe(aboveRange.bids.length);
    expect(aboveRange.asks).toEqual([]);
  });

  it("keeps only unique levels inside the hard range", () => {
    const targets = buildGrowthSpaceLadderPrices(105_000);

    expect(
      targets.bids.every((price) => price >= CFG.HARD_MIN_PRICE && price <= CFG.HARD_MAX_PRICE),
    ).toBe(true);
    expect(
      targets.asks.every((price) => price >= CFG.HARD_MIN_PRICE && price <= CFG.HARD_MAX_PRICE),
    ).toBe(true);
    expect(new Set(targets.bids).size).toBe(targets.bids.length);
    expect(new Set(targets.asks).size).toBe(targets.asks.length);
  });

  it("filters levels that would be marketable for ALO orders", () => {
    const targets = buildGrowthSpaceLadderPrices(115_000, {
      assetId: 1n,
      epoch: 1n,
      seqId: 1n,
      ts: 1n,
      bids: [{ price: 108_000, size: 1, orderCount: 1, orders: [] }],
      asks: [{ price: 102_000, size: 1, orderCount: 1, orders: [] }],
    });

    expect(targets.bids).toEqual([]);
    expect(targets.asks.every((price) => price > 108_000)).toBe(true);
  });
});

describe("reference source freshness", () => {
  const quotedBook = {
    assetId: 1n,
    epoch: 1n,
    seqId: 1n,
    ts: 1n,
    bids: [{ price: 400_000, size: 1, orderCount: 1, orders: [] }],
    asks: [],
  };

  it("does not treat an empty book as a usable reference source", () => {
    expect(
      hasUsableBookPrice({
        ...quotedBook,
        bids: [],
        asks: [],
      }),
    ).toBe(false);
    expect(hasUsableBookPrice(quotedBook)).toBe(true);
  });

  it("requires the usable book to have been updated recently", () => {
    STATE.bookUpdatedAtMs = Date.now();
    expect(hasFreshBook(quotedBook)).toBe(true);

    STATE.bookUpdatedAtMs = Date.now() - CFG.BOOK_STALE_MS - 1;
    expect(hasFreshBook(quotedBook)).toBe(false);
  });
});

describe("total size ladder distribution", () => {
  it("allocates more contracts to prices farther from the best bid", () => {
    (CFG as any).QUOTE_SIZE_CONCAVITY = 1;
    const sizes = distributeTotalSizeAcrossLadder(1_000_000, [490_000, 480_000, 460_000], "buy");

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(1_000_000);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
  });

  it("allocates more contracts to prices farther from the best ask", () => {
    const sizes = distributeTotalSizeAcrossLadder(1_000_000, [510_000, 520_000, 540_000], "sell");

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(1_000_000);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
  });

  it("allocates independently when the sides have different level counts", () => {
    const bidSizes = distributeTotalSizeAcrossLadder(500_000, [490_000, 480_000, 460_000], "buy");
    const askSizes = distributeTotalSizeAcrossLadder(500_000, [510_000, 540_000], "sell");

    expect(bidSizes.reduce((sum, size) => sum + size, 0)).toBe(500_000);
    expect(askSizes.reduce((sum, size) => sum + size, 0)).toBe(500_000);
  });

  it("returns no allocations when there are no target prices", () => {
    expect(distributeTotalSizeAcrossLadder(1_000_000, [], "buy")).toEqual([]);
  });

  it("changes the concentration using the concavity parameter", () => {
    (CFG as any).QUOTE_SIZE_CONCAVITY = 1;
    const linear = distributeTotalSizeAcrossLadder(1_000_000, [490_000, 480_000, 460_000], "buy");
    (CFG as any).QUOTE_SIZE_CONCAVITY = 3;
    const concentrated = distributeTotalSizeAcrossLadder(
      1_000_000,
      [490_000, 480_000, 460_000],
      "buy",
    );

    expect(concentrated[2]).toBeGreaterThan(linear[2]);
  });
});

describe("total quote sizes", () => {
  const asset = {
    assetId: 1n,
    epoch: 1n,
    registered: true,
    expiration: 1_100n,
    assetType: 2n,
    strikePrice: 500_000n,
    resolutionPrice: 0n,
    isResolved: false,
    ledger: "0xledger",
  } as Asset;

  it("starts at the configured total size and collapses at expiration", () => {
    STATE.periodLength = 100;
    STATE.invBase = 0;
    (CFG as any).INV_TARGET = 0;
    (CFG as any).INV_MAX_ABS = 10_000_000;
    STATE.accountBalance = 1_000_000;
    (CFG as any).MAX_CONTRACT_EXPOSURE_PCT = 100;
    (CFG as any).TOTAL_SIZE_DECAY_K = 2;
    (CFG as any).TOTAL_SIZE_DECAY_A = 0.5;
    (CFG as any).TOTAL_SIZE_TIME_BUCKET_SECONDS = 5;

    expect(calculateTotalSizes(asset, 1_000_000)).toEqual({
      bidSize: 1_000_000,
      askSize: 1_000_000,
    });
    expect(calculateTotalSizes(asset, 1_100_000)).toEqual({
      bidSize: 0,
      askSize: 0,
    });
  });

  it("uses signed inventory to bias total size toward the reducing side", () => {
    STATE.periodLength = 100;
    STATE.invBase = 200_000;
    (CFG as any).INV_TARGET = 0;
    (CFG as any).INV_MAX_ABS = 10_000_000;
    STATE.accountBalance = 1_000_000;
    (CFG as any).MAX_CONTRACT_EXPOSURE_PCT = 100;
    (CFG as any).TOTAL_SIZE_DECAY_K = 2;
    (CFG as any).TOTAL_SIZE_DECAY_A = 0.5;
    (CFG as any).TOTAL_SIZE_TIME_BUCKET_SECONDS = 5;

    expect(calculateTotalSizes(asset, 1_000_000)).toEqual({
      bidSize: 800_000,
      askSize: 1_000_000,
    });
  });

  it("changes only at the configured time buckets", () => {
    STATE.periodLength = 100;
    STATE.invBase = 0;
    (CFG as any).INV_TARGET = 0;
    (CFG as any).INV_MAX_ABS = 10_000_000;
    STATE.accountBalance = 1_000_000;
    (CFG as any).MAX_CONTRACT_EXPOSURE_PCT = 100;
    (CFG as any).TOTAL_SIZE_DECAY_K = 2;
    (CFG as any).TOTAL_SIZE_DECAY_A = 0.5;
    (CFG as any).TOTAL_SIZE_TIME_BUCKET_SECONDS = 5;

    expect(calculateTotalSizes(asset, 1_001_000)).toEqual(calculateTotalSizes(asset, 1_004_000));
    expect(calculateTotalSizes(asset, 1_005_000)).toEqual(calculateTotalSizes(asset, 1_009_000));
    expect(calculateTotalSizes(asset, 1_004_000)).not.toEqual(
      calculateTotalSizes(asset, 1_005_000),
    );
  });
});

describe("capital exposure limits", () => {
  it("limits collateral by the configured percentage", () => {
    STATE.baseBal = 10_000_000;
    (CFG as any).BASE_RESERVE_MIN = 1_500_000;
    (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = 25;

    expect(availableCollateral()).toBe(2_500_000);
  });

  it("still honors the base balance reserve when the percentage is high", () => {
    STATE.baseBal = 10_000_000;
    (CFG as any).BASE_RESERVE_MIN = 1_500_000;
    (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = 100;

    expect(availableCollateral()).toBe(8_500_000);
  });

  it("caps an order using its side-specific margin price", () => {
    STATE.baseBal = 10_000_000;
    (CFG as any).BASE_RESERVE_MIN = 0;
    (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = 100;
    // The full available collateral is used; at 50 cents it supports
    // 20,000,000 protocol-size units.
    expect(capOrderSizeByMargin(true, 100_000_000, 500_000, 10_000_000)).toBe(20_000_000);
  });
});

describe("inventory skew", () => {
  it("calculates positive skew for positive inventory", () => {
    expect(calculateInventorySkew(2, 100, 500_000)).toBe(50);
  });

  it("changes sign with inventory", () => {
    expect(calculateInventorySkew(2, -100, 500_000)).toBe(-50);
  });

  it("is zero at the price boundaries", () => {
    expect(calculateInventorySkew(2, 100, 0)).toBe(0);
    expect(calculateInventorySkew(2, 100, 1_000_000)).toBe(0);
  });

  it("rejects an invalid reference price", () => {
    expect(() => calculateInventorySkew(1, 100, -1)).toThrow();
    expect(() => calculateInventorySkew(1, 100, 1_000_001)).toThrow();
  });
});

describe("risk aversion factor", () => {
  it("starts at gamma_0 and reaches gamma_max at expiration", () => {
    expect(calculateRiskAversionFactor(1, 5, 100, 100, 2)).toBe(1);
    expect(calculateRiskAversionFactor(1, 5, 0, 100, 2)).toBe(5);
  });

  it("increases as the epoch gets closer to expiration", () => {
    const early = calculateRiskAversionFactor(1, 5, 75, 100, 2);
    const late = calculateRiskAversionFactor(1, 5, 25, 100, 2);

    expect(late).toBeGreaterThan(early);
  });

  it("requires valid risk-aversion parameters", () => {
    expect(() => calculateRiskAversionFactor(0, 5, 50, 100, 2)).toThrow();
    expect(() => calculateRiskAversionFactor(5, 5, 50, 100, 2)).toThrow();
    expect(() => calculateRiskAversionFactor(1, 5, 50, 100, 0.9)).toThrow();
    expect(() => calculateRiskAversionFactor(1, 5, 101, 100, 2)).toThrow();
  });
});

describe("asset-aware risk aversion", () => {
  const asset: Asset = {
    assetId: encodeAssetId(1, 2, 1_000, 900, "500000", 0),
    epoch: 1n,
    registered: true,
    expiration: 1_900n,
    assetType: 2n,
    strikePrice: 500_000n,
    resolutionPrice: 0n,
    isResolved: false,
    ledger: "0xledger",
  };

  it("derives period length and remaining time from the asset", () => {
    STATE.periodLength = 900;
    expect(calculateRemainingEpochSeconds(asset, 1_500_000)).toEqual({
      periodLength: 900,
      remainingSeconds: 400,
    });
  });

  it("uses the current asset timing to calculate risk aversion", () => {
    STATE.periodLength = 900;
    const gamma = calculateCurrentRiskAversion(asset, 1_500_000);

    expect(gamma).toBeGreaterThan(CFG.RISK_AVERSION_GAMMA_0);
    expect(gamma).toBeLessThan(CFG.RISK_AVERSION_GAMMA_MAX);
  });
});

describe("logit bid and ask calculation", () => {
  it("returns a symmetric bid and ask without inventory skew", () => {
    const result = calculateBidAndAsk(500_000, 0, 0.5);

    expect(result.bid).toBeLessThan(0.5);
    expect(result.ask).toBeGreaterThan(0.5);
    expect(result.bid + result.ask).toBeCloseTo(1);
  });

  it("shifts both quotes lower for positive inventory skew", () => {
    const neutral = calculateBidAndAsk(500_000, 0, 0.5);
    const skewed = calculateBidAndAsk(500_000, 1, 0.5);

    expect(skewed.bid).toBeLessThan(neutral.bid);
    expect(skewed.ask).toBeLessThan(neutral.ask);
  });

  it("rejects invalid half-spreads and reference prices", () => {
    expect(() => calculateBidAndAsk(500_000, 0, 0.004)).toThrow();
    expect(() => calculateBidAndAsk(500_000, 0, 1.001)).toThrow();
    expect(() => calculateBidAndAsk(0, 0, 0.5)).toThrow();
  });
});
