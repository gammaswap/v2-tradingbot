import { describe, expect, it } from "vitest";
import { InMemoryQuoteCooldownStore, QuoteCooldownManager } from "../src/runtime/quoteCooldown.js";

const key = { assetId: "1", epoch: 4n, quoteSlot: "buy:400000" };

describe("quote cooldowns", () => {
    it("blocks a quote slot until its cooldown expires", () => {
        const manager = new QuoteCooldownManager(new InMemoryQuoteCooldownStore(), 5_000);
        manager.start(key, "ALO rejection", 100_000);

        expect(manager.isCoolingDown(key, 104_999)).toBe(true);
        expect(manager.getRemainingMs(key, 104_999)).toBe(1);
        expect(manager.isCoolingDown(key, 105_000)).toBe(false);
        expect(manager.getRemainingMs(key, 105_000)).toBe(0);
    });

    it("keeps cooldowns isolated by epoch and quote slot", () => {
        const manager = new QuoteCooldownManager(new InMemoryQuoteCooldownStore(), 5_000);
        manager.start(key, "rejected", 100_000);

        expect(manager.isCoolingDown({ ...key, quoteSlot: "buy:450000" }, 101_000)).toBe(false);
        expect(manager.isCoolingDown({ ...key, epoch: 5n }, 101_000)).toBe(false);
    });
});
