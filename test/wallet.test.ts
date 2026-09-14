import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { resolveTradingWallet } from "../src/runtime/wallet.js";

describe("trading wallet resolution", () => {
  it("derives the standalone runner wallet from the configured mnemonic", () => {
    const wallet = resolveTradingWallet();
    expect(wallet).toBeInstanceOf(Wallet);
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/i);
  });
});
