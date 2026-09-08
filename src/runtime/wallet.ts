import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { Wallet } from "ethers";
import { CFG } from "../config/config.js";

/**
 * Uses the caller's wallet when provided; otherwise derives the configured
 * wallet from MNEMONIC and WALLET_INDEX for CLI/local usage.
 */
export function resolveTradingWallet(wallet?: Wallet): Wallet {
  if (wallet) return wallet;

  if (!CFG.MNEMONIC.trim()) {
    throw new Error("wallet was not provided and MNEMONIC is not configured");
  }
  if (!Number.isInteger(CFG.WALLET_INDEX) || CFG.WALLET_INDEX < 0) {
    throw new Error("WALLET_INDEX must be a non-negative integer");
  }

  const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
  if (!account) {
    throw new Error(`unable to derive wallet at index ${CFG.WALLET_INDEX}`);
  }

  return new Wallet(account.privateKey);
}
