import { afterEach, describe, expect, it } from "vitest";
import { CFG } from "../src/config/config.js";
import { STATE } from "../src/runtime/state.js";
import { availableCollateral, buildTargetLadderPrices } from "../src/runtime/strategy.js";

const originalBaseBal = STATE.baseBal;
const originalReserve = CFG.BASE_RESERVE_MIN;
const originalExposurePercent = CFG.MAX_CAPITAL_EXPOSURE_PERCENT;

afterEach(() => {
    STATE.baseBal = originalBaseBal;
    (CFG as any).BASE_RESERVE_MIN = originalReserve;
    (CFG as any).MAX_CAPITAL_EXPOSURE_PERCENT = originalExposurePercent;
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
});
