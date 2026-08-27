import { afterEach, describe, expect, it, vi } from "vitest";
import {
    validateOrderSizeConfiguration,
    validatePriceConfiguration,
    validateProductionConfig,
    validateRiskConfiguration,
} from "../src/config/config.js";

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
            expect.stringContaining("API_URL"),
        ]));
    });

    it("does not enforce production settings in development mode", () => {
        expect(validateProductionConfig({})).toEqual([]);
    });
});

describe("price configuration validation", () => {
    it("accepts the default nested strategy range", async () => {
        const { CFG } = await import("../src/config/config.js");
        expect(validatePriceConfiguration(CFG)).toEqual([]);
    });

    it("rejects strategy prices outside the protocol range", () => {
        const errors = validatePriceConfiguration({
            HARD_MIN_PRICE: 999,
            HARD_MAX_PRICE: 1_000_000,
            SOFT_MIN_PRICE: 2_000,
            SOFT_MAX_PRICE: 998_000,
            CENTER_PRICE: 500_000,
        } as never);

        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining("HARD_MIN_PRICE"),
            expect.stringContaining("HARD_MAX_PRICE"),
        ]));
    });

    it("requires the center price to remain inside the soft range", () => {
        const errors = validatePriceConfiguration({
            HARD_MIN_PRICE: 100_000,
            HARD_MAX_PRICE: 900_000,
            SOFT_MIN_PRICE: 300_000,
            SOFT_MAX_PRICE: 700_000,
            CENTER_PRICE: 800_000,
        } as never);

        expect(errors).toContain("CENTER_PRICE must be between SOFT_MIN_PRICE and SOFT_MAX_PRICE");
    });

    it("rejects order sizes outside the protocol limits", () => {
        const errors = validateOrderSizeConfiguration({
            LOT_SIZE: 1,
            QUOTE_BASE_SIZE_MIN: 10_000,
            QUOTE_BASE_SIZE_MAX: 100_000_000_000,
            MAX_AGGRESS_QTY: 100_000_000_001,
            MAX_ORDER_SIZE: 100_000_000_000,
        } as never);

        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining("LOT_SIZE"),
            expect.stringContaining("MAX_AGGRESS_QTY"),
        ]));
    });

    it("rejects an invalid capital exposure percentage", () => {
        expect(validateRiskConfiguration({
            MAX_CAPITAL_EXPOSURE_PERCENT: 101,
            BASE_RESERVE_MIN: 1_500_000,
        } as never)).toContain(
            "MAX_CAPITAL_EXPOSURE_PERCENT must be between 0 and 100",
        );
    });

    it("rejects an invalid logit half-spread", () => {
        expect(validateRiskConfiguration({
            MAX_CAPITAL_EXPOSURE_PERCENT: 100,
            RISK_AVERSION_GAMMA_0: 1e-9,
            RISK_AVERSION_GAMMA_MAX: 1e-8,
            RISK_AVERSION_B: 5,
            LOGIT_HALF_SPREAD: 1.001,
            BASE_RESERVE_MIN: 1_500_000,
        } as never)).toContain(
            "LOGIT_HALF_SPREAD must be between 0.005 and 1",
        );
    });

    it("requires quote slots to be an integer between 1 and 100", () => {
        const base = {
            MAX_CAPITAL_EXPOSURE_PERCENT: 100,
            RISK_AVERSION_GAMMA_0: 1e-9,
            RISK_AVERSION_GAMMA_MAX: 1e-8,
            RISK_AVERSION_B: 5,
            LOGIT_HALF_SPREAD: 0.5,
            BASE_RESERVE_MIN: 1_500_000,
        };

        expect(validateRiskConfiguration({ ...base, LEVELS_PER_SIDE: 0 } as never))
            .toContain("LEVELS_PER_SIDE must be an integer between 1 and 100");
        expect(validateRiskConfiguration({ ...base, LEVELS_PER_SIDE: 2.5 } as never))
            .toContain("LEVELS_PER_SIDE must be an integer between 1 and 100");
        expect(validateRiskConfiguration({ ...base, LEVELS_PER_SIDE: 101 } as never))
            .toContain("LEVELS_PER_SIDE must be an integer between 1 and 100");
    });

    it("validates total quote size and decay parameters", () => {
        const base = {
            MAX_CAPITAL_EXPOSURE_PERCENT: 100,
            RISK_AVERSION_GAMMA_0: 1e-9,
            RISK_AVERSION_GAMMA_MAX: 1e-8,
            RISK_AVERSION_B: 5,
            LOGIT_HALF_SPREAD: 0.5,
            LEVELS_PER_SIDE: 5,
            TOTAL_SIZE_DECAY_K: 2,
            TOTAL_SIZE_DECAY_A: 0.5,
            TOTAL_SIZE_TIME_BUCKET_SECONDS: 5,
            BASE_RESERVE_MIN: 1_500_000,
        };

        expect(validateRiskConfiguration({
            ...base,
            TOTAL_SIZE_DECAY_K: 1,
            TOTAL_SIZE_DECAY_A: 1,
            TOTAL_SIZE_TIME_BUCKET_SECONDS: 31,
        } as never)).toEqual(expect.arrayContaining([
            "TOTAL_SIZE_DECAY_K must be greater than 1",
            "TOTAL_SIZE_DECAY_A must be greater than 0 and less than 1",
            "TOTAL_SIZE_TIME_BUCKET_SECONDS must be an integer between 1 and 30",
        ]));
    });

    it("validates quote-size concavity", () => {
        const base = {
            MAX_CAPITAL_EXPOSURE_PERCENT: 100,
            RISK_AVERSION_GAMMA_0: 1e-9,
            RISK_AVERSION_GAMMA_MAX: 1e-8,
            RISK_AVERSION_B: 5,
            LOGIT_HALF_SPREAD: 0.5,
            LEVELS_PER_SIDE: 5,
            QUOTE_SIZE_CONCAVITY: 1,
            BASE_RESERVE_MIN: 1_500_000,
        };

        expect(validateRiskConfiguration({
            ...base,
            QUOTE_SIZE_CONCAVITY: 0,
        } as never)).toContain(
            "QUOTE_SIZE_CONCAVITY must be greater than 0 and at most 10",
        );
        expect(validateRiskConfiguration({
            ...base,
            QUOTE_SIZE_CONCAVITY: 10.1,
        } as never)).toContain(
            "QUOTE_SIZE_CONCAVITY must be greater than 0 and at most 10",
        );
    });

    it("requires contract exposure percentage to be between 1 and 100", () => {
        const base = {
            MAX_CAPITAL_EXPOSURE_PERCENT: 100,
            RISK_AVERSION_GAMMA_0: 1e-9,
            RISK_AVERSION_GAMMA_MAX: 1e-8,
            RISK_AVERSION_B: 5,
            LOGIT_HALF_SPREAD: 0.5,
            LEVELS_PER_SIDE: 5,
            QUOTE_SIZE_CONCAVITY: 1,
            BASE_RESERVE_MIN: 1_500_000,
        };

        expect(validateRiskConfiguration({
            ...base,
            MAX_CONTRACT_EXPOSURE_PCT: 0.9,
        } as never)).toContain(
            "MAX_CONTRACT_EXPOSURE_PCT must be between 1 and 100",
        );
        expect(validateRiskConfiguration({
            ...base,
            MAX_CONTRACT_EXPOSURE_PCT: 100.1,
        } as never)).toContain(
            "MAX_CONTRACT_EXPOSURE_PCT must be between 1 and 100",
        );
    });
});
