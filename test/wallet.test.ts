import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { resolveTradingWallet } from "../src/runtime/wallet.js";

describe("trading wallet resolution", () => {
  it("prefers an explicitly supplied wallet", () => {
    const wallet = Wallet.createRandom() as unknown as Wallet;
    expect(resolveTradingWallet(wallet)).toBe(wallet);
  });

  it("derives a wallet from the configured mnemonic when omitted", () => {
    const wallet = resolveTradingWallet();
    expect(wallet).toBeInstanceOf(Wallet);
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/i);
  });
});
