import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { TradingBot, validateTradingBotOptions, type TradingBotOptions } from "../src/index.js";

const validOptions: TradingBotOptions = {
  wallet: Wallet.createRandom() as unknown as Wallet,
  apiUrl: "https://example.com/api",
  assetId: "1",
  chainId: 1,
  contracts: {
    exchange: "0x1111111111111111111111111111111111111111",
    ledger: "0x2222222222222222222222222222222222222222",
    settlementToken: "0x3333333333333333333333333333333333333333",
  },
};

describe("public package API", () => {
  it("exports the documented bot constructor and validation helper", () => {
    expect(TradingBot).toBeTypeOf("function");
    expect(validateTradingBotOptions(validOptions)).toEqual([]);
  });

  it("reports actionable consumer configuration errors", () => {
    expect(
      validateTradingBotOptions({
        ...validOptions,
        apiUrl: "not-a-url",
        api: { key: "only-a-key" },
        contracts: {
          ...validOptions.contracts,
          exchange: "0x0000000000000000000000000000000000000000",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "apiUrl must be a valid URL",
        "api.key and api.secret must be configured together",
        "exchange must be a non-zero valid address",
      ]),
    );
  });
});
