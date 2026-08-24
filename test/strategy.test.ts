import { describe, expect, it } from "vitest";
import { buildTargetLadderPrices } from "../src/runtime/strategy.js";

describe("target quote ladder prices", () => {
    it("does not clamp out-of-range levels to duplicate hard boundaries", () => {
        const belowRange = buildTargetLadderPrices(50_000);
        const aboveRange = buildTargetLadderPrices(950_000);

        expect(belowRange.bids).toEqual([]);
        expect(belowRange.asks).toEqual([]);
        expect(aboveRange.bids).toEqual([]);
        expect(aboveRange.asks).toEqual([]);
    });

    it("keeps only unique levels inside the hard range", () => {
        const targets = buildTargetLadderPrices(105_000);

        expect(targets.bids.every((price) => price >= 100_000 && price <= 900_000)).toBe(true);
        expect(targets.asks.every((price) => price >= 100_000 && price <= 900_000)).toBe(true);
        expect(new Set(targets.bids).size).toBe(targets.bids.length);
        expect(new Set(targets.asks).size).toBe(targets.asks.length);
    });

    it("filters levels that would be marketable for ALO orders", () => {
        const targets = buildTargetLadderPrices(110_000, {
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
