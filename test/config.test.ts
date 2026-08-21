import { afterEach, describe, expect, it, vi } from "vitest";

const originalTimeout = process.env.API_TIMEOUT_MS;

afterEach(() => {
    if (originalTimeout === undefined) delete process.env.API_TIMEOUT_MS;
    else process.env.API_TIMEOUT_MS = originalTimeout;
    vi.resetModules();
});

describe("API timeout configuration", () => {
    it("defaults to 30 seconds", async () => {
        delete process.env.API_TIMEOUT_MS;
        vi.resetModules();

        const { CFG } = await import("../src/config/config.js");
        expect(CFG.API_TIMEOUT_MS).toBe(30_000);
    });

    it("accepts an environment override", async () => {
        process.env.API_TIMEOUT_MS = "10000";
        vi.resetModules();

        const { CFG } = await import("../src/config/config.js");
        expect(CFG.API_TIMEOUT_MS).toBe(10_000);
    });

    it("falls back when the environment value is invalid", async () => {
        process.env.API_TIMEOUT_MS = "not-a-number";
        vi.resetModules();

        const { CFG } = await import("../src/config/config.js");
        expect(CFG.API_TIMEOUT_MS).toBe(30_000);
    });
});
