import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { resolveTradingWallet } from "../src/runtime/wallet.js";

describe("trading wallet resolution", () => {
  const mnemonic = "test test test test test test test test test test test junk";
  const privateKey = Wallet.createRandom().privateKey;

  it("uses PRIVATE_KEY when both credential types are configured", () => {
    const wallet = resolveTradingWallet({
      PRIVATE_KEY: privateKey,
      MNEMONIC: "not a valid mnemonic and therefore not evaluated",
      WALLET_INDEX: 123,
    });

    expect(wallet.address).toBe(new Wallet(privateKey).address);
  });

  it("derives mnemonic account zero when WALLET_INDEX is omitted", () => {
    expect(resolveTradingWallet({ MNEMONIC: mnemonic }).address).toBe(
      resolveTradingWallet({ MNEMONIC: mnemonic, WALLET_INDEX: 0 }).address,
    );
  });

  it("derives the requested mnemonic account when WALLET_INDEX is configured", () => {
    expect(resolveTradingWallet({ MNEMONIC: mnemonic, WALLET_INDEX: 1 }).address).not.toBe(
      resolveTradingWallet({ MNEMONIC: mnemonic, WALLET_INDEX: 0 }).address,
    );
  });

  it("rejects an invalid private key and missing credentials", () => {
    expect(() => resolveTradingWallet({ PRIVATE_KEY: "not-a-private-key" })).toThrow(
      "PRIVATE_KEY must be a valid Ethereum private key",
    );
    expect(() => resolveTradingWallet({})).toThrow("PRIVATE_KEY or MNEMONIC must be configured");
  });
});
