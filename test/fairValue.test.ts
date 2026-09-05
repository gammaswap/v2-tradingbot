import { describe, expect, it } from "vitest";
import { computeFairValueEstimate } from "../src/runtime/fairValue.js";
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
        const above = computeFairValueEstimate(600_000n, asset({ expiration: 1_700_000_000n }), 1_700_000_000_000);
        const below = computeFairValueEstimate(400_000n, asset({ expiration: 1_700_000_000n }), 1_700_000_000_000);

        expect(above?.probability).toBe(1);
        expect(below?.probability).toBe(0);
    });

    it("honors the configured expiration in the result", () => {
        const estimate = computeFairValueEstimate(500_000n, asset({ expiration: 1_700_001_000n }), 1_700_000_000_000);

        expect(estimate?.expiresInSec).toBe(1_000);
    });
});
