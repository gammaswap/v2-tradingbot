import { describe, expect, it } from "vitest";
import { CFG } from "../src/config/config.js";
import {
  getInfoClientOptions,
  normalizeAsset,
  protocolAmountToSdkInput,
  protocolPriceToSdkInput,
} from "../src/api/api.js";

describe("asset API normalization", () => {
  it("normalizes an unresolved asset without inferring resolution from price", () => {
    expect(
      normalizeAsset({
        assetId: "123",
        epoch: "7",
        registered: true,
        expiration: "1700000900",
        assetType: "2",
        strikePrice: "500000",
        resolutionPrice: "0",
        isResolved: false,
        ledger: "0xledger",
      }),
    ).toEqual({
      assetId: 123n,
      epoch: 7n,
      registered: true,
      expiration: 1700000900n,
      assetType: 2n,
      strikePrice: 500000n,
      resolutionPrice: 0n,
      isResolved: false,
      ledger: "0xledger",
    });
  });

  it("trusts isResolved even when resolutionPrice is zero", () => {
    const asset = normalizeAsset({
      assetId: "123",
      epoch: "8",
      registered: true,
      expiration: "1700001800",
      assetType: "2",
      strikePrice: "500000",
      resolutionPrice: "0",
      isResolved: true,
      ledger: "0xledger",
    });

    expect(asset.isResolved).toBe(true);
    expect(asset.resolutionPrice).toBe(0n);
  });

  it("rejects malformed protocol numeric fields", () => {
    expect(() =>
      normalizeAsset({
        assetId: "123",
        epoch: "not-a-number",
        registered: true,
        expiration: "1700000900",
        assetType: "2",
        strikePrice: "500000",
        resolutionPrice: "0",
        isResolved: false,
        ledger: "0xledger",
      }),
    ).toThrow("Invalid bigint field asset.epoch");
  });
});

describe("API client configuration", () => {
  it("passes the configured timeout to the SDK info client", () => {
    expect(getInfoClientOptions().timeoutMs).toBe(CFG.API_TIMEOUT_MS);
  });
});

describe("existing API value conversions", () => {
  it("preserves the SDK input conversions used by orders", () => {
    expect(protocolPriceToSdkInput(500000n)).toBe("50.0");
    expect(protocolAmountToSdkInput(1_250_000n)).toBe("1.25");
  });
});
