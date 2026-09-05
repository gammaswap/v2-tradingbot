import { describe, expect, it } from "vitest";
import { createBotContext, getBotContext, runWithBotContext } from "../src/runtime/context.js";

describe("bot context", () => {
    it("keeps state and configuration isolated between bot instances", async () => {
        const first = createBotContext({ ASSET_ID: "101", CENTER_PRICE: 400_000 });
        const second = createBotContext({ ASSET_ID: "202", CENTER_PRICE: 600_000 });

        await runWithBotContext(first, async () => {
            getBotContext().state.epoch = 11n;
            expect(getBotContext().config.ASSET_ID).toBe("101");
        });

        await runWithBotContext(second, async () => {
            expect(getBotContext().config.ASSET_ID).toBe("202");
            expect(getBotContext().state.epoch).toBe(0n);
        });

        expect(first.state.epoch).toBe(11n);
        expect(second.state.epoch).toBe(0n);
    });
});
