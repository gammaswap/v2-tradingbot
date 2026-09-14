import { describe, expect, it } from "vitest";
import {
  DEFAULT_CFG,
  createConfigFromEnvironment,
  validateProductionConfig,
} from "../src/config/config.js";

describe("library configuration isolation", () => {
  it("derives standalone configuration from an explicitly supplied environment", () => {
    const config = createConfigFromEnvironment({
      API_URL: "https://example.com/api",
      IS_TAKER: "true",
      CENTER_PRICE: "400000",
    });

    expect(config.API_URL).toBe("https://example.com/api");
    expect(config.IS_TAKER).toBe(true);
    expect(config.CENTER_PRICE).toBe(400_000);
    expect(DEFAULT_CFG.CENTER_PRICE).toBe(500_000);
  });

  it("validates the environment being supplied, rather than process-level config", () => {
    expect(validateProductionConfig({ HARD_MIN_PRICE: "900000", HARD_MAX_PRICE: "1000" })).toEqual(
      expect.arrayContaining(["HARD_MIN_PRICE must not exceed HARD_MAX_PRICE"]),
    );
  });
});
