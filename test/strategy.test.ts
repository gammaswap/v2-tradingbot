import { afterEach, describe, expect, it } from "vitest";
import { CFG } from "../src/config/config.js";
import { STATE } from "../src/runtime/state.js";
import { encodeAssetId } from "../src/utils/assetIdUtils.js";
import type { Asset } from "../src/utils/types.js";
import {
    availableCollateral,
    buildTargetLadderPrices,
    capOrderSizeByMargin,
    calculateBidAndAsk,
    calculateCurrentRiskAversion,
    calculateInventorySkew,
    calculateRemainingEpochSeconds,
    calculateRiskAversionFactor,
} from "../src/runtime/strategy.js";

const originalBaseBal = STATE.baseBal;
const originalReserve = CFG.BASE_RESERVE_MIN;
const originalExposurePercent = CFG.MAX_CAPITAL_EXPOSURE_PERCENT;
const originalOrderMarginPercent = CFG.MAX_ORDER_MARGIN_PERCENT;
const originalPeriodLength = STATE.periodLength;

afterEach(() => {
    STATE.baseBal = originalBaseBal;
    (CFG as any).BASE_RESERVE_MIN = originalReserve;
    (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = originalExposurePercent;
    (CFG as any).MAX_ORDER_MARGIN_PERCENT = originalOrderMarginPercent;
    STATE.periodLength = originalPeriodLength;
});

describe("target quote ladder prices", () => {
    it("does not clamp out-of-range levels to duplicate hard boundaries", () => {
        const belowRange = buildTargetLadderPrices(0);
        const aboveRange = buildTargetLadderPrices(1_000_000);

        expect(belowRange.bids).toEqual([]);
        expect(new Set(belowRange.asks).size).toBe(belowRange.asks.length);
        expect(aboveRange.asks).toEqual([]);
        expect(new Set(aboveRange.bids).size).toBe(aboveRange.bids.length);
        expect(aboveRange.asks).toEqual([]);
    });

    it("keeps only unique levels inside the hard range", () => {
        const targets = buildTargetLadderPrices(105_000);

        expect(targets.bids.every((price) => price >= CFG.HARD_MIN_PRICE && price <= CFG.HARD_MAX_PRICE)).toBe(true);
        expect(targets.asks.every((price) => price >= CFG.HARD_MIN_PRICE && price <= CFG.HARD_MAX_PRICE)).toBe(true);
        expect(new Set(targets.bids).size).toBe(targets.bids.length);
        expect(new Set(targets.asks).size).toBe(targets.asks.length);
    });

    it("filters levels that would be marketable for ALO orders", () => {
        const targets = buildTargetLadderPrices(115_000, {
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
        (CFG as any).MAX_ORDER_MARGIN_PERCENT = 10;

        // A 10% margin budget is 1,000,000; at 50 cents that supports 2,000,000 size.
        expect(capOrderSizeByMargin(true, 100_000_000, 500_000, 10_000_000)).toBe(2_000_000);
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
