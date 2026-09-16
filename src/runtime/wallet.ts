import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { Wallet } from "ethers";
import { CFG } from "../config/config.js";

type WalletCredentials = {
  PRIVATE_KEY?: string;
  MNEMONIC?: string;
  WALLET_INDEX?: number;
};

/**
 * Resolves the wallet used by the repository's environment-driven standalone
 * runner. PRIVATE_KEY takes precedence over MNEMONIC; mnemonic derivation uses
 * WALLET_INDEX, which defaults to zero. Package consumers supply a Wallet
 * directly to TradingBot instead.
 */
export function resolveTradingWallet(credentials: WalletCredentials = CFG): Wallet {
  const privateKey = credentials.PRIVATE_KEY?.trim();
  if (privateKey) {
    try {
      return new Wallet(privateKey);
    } catch {
      throw new Error("PRIVATE_KEY must be a valid Ethereum private key");
    }
  }

  const mnemonic = credentials.MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("PRIVATE_KEY or MNEMONIC must be configured");
  }

  const walletIndex = credentials.WALLET_INDEX ?? 0;
  if (!Number.isInteger(walletIndex) || walletIndex < 0) {
    throw new Error("WALLET_INDEX must be a non-negative integer");
  }

  const account = deriveAccountsFromMnemonic(mnemonic, walletIndex + 1)[walletIndex];
  if (!account) {
    throw new Error(`unable to derive wallet at index ${walletIndex}`);
  }

  return new Wallet(account.privateKey);
}
