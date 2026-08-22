import { describe, expect, it } from "vitest";
import {
    protocolMulDiv,
    protocolNotional,
    protocolNotionalBigInt,
} from "../src/utils/protocolMath.js";

describe("protocol arithmetic", () => {
    it("calculates protocol notional with exact integer arithmetic", () => {
        expect(protocolNotional(1_000_000, 500_000)).toBe(500_000);
        expect(protocolNotional(10_000_000, 999_000)).toBe(9_990_000);
    });

    it("keeps large intermediate multiplication exact", () => {
        const size = 9_000_000_000_000_000n;
        const price = 999_000n;
        const expected = (size * price) / 1_000_000n;

        expect(protocolNotionalBigInt(size, price)).toBe(expected);
        expect(protocolMulDiv(size, price)).toBe(expected);
    });

    it("rejects non-integer numeric protocol values", () => {
        expect(() => protocolNotional(1.5, 500_000)).toThrow(/safe integer/);
    });
});
