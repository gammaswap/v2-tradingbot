import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProductionConfig } from "../src/config/config.js";

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

describe("production configuration validation", () => {
    it("rejects the development defaults in production mode", () => {
        const errors = validateProductionConfig({
            PRODUCTION_MODE: "true",
            MNEMONIC: "test test test test test test test test test test test junk",
            RPC_URL: "http://localhost:8545",
        });

        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining("MNEMONIC"),
            expect.stringContaining("RPC_URL"),
            expect.stringContaining("API_URL"),
        ]));
    });

    it("does not enforce production settings in development mode", () => {
        expect(validateProductionConfig({})).toEqual([]);
    });
});
