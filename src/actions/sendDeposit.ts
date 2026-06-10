import "dotenv/config";
import { ethers } from "ethers";
import { CFG } from "../config/config.js";
import { createRequire } from "node:module";
import { deriveAccountsFromMnemonic } from "../utils/eip712.js";

const require = createRequire(import.meta.url);
const { abi: DEPOSIT_LEDGER_ABI } = require("@gammaswap/v2-exchange/out/DepositLedger.sol/DepositLedger.json");

const DEPOSIT_AMOUNT = 100_000_000_000n;

async function main() {
    console.log("=".repeat(80));
    console.log("DepositLedger deposit() Test");
    console.log("=".repeat(80));
    console.log("RPC_URL:", CFG.RPC_URL);
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("DEPOSIT_LEDGER_CONTRACT:", CFG.DEPOSIT_LEDGER_ADDRESS);
    console.log("WALLET_INDEX:", CFG.WALLET_INDEX);
    console.log("DEPOSIT_AMOUNT:", DEPOSIT_AMOUNT);

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    console.log("Using wallet:", account.address);

    const provider = new ethers.JsonRpcProvider(CFG.RPC_URL);
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const depositLedger = new ethers.Contract( CFG.DEPOSIT_LEDGER_ADDRESS, DEPOSIT_LEDGER_ABI, wallet);

    const settlementToken = await depositLedger.SETTLEMENT_TOKEN();
    const pendingDepositCountBefore = await depositLedger.pendingDepositCount();

    console.log("Settlement token:", settlementToken);
    console.log("Pending deposit count before:", pendingDepositCountBefore.toString());

    const tx = await depositLedger.deposit(DEPOSIT_AMOUNT);
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt?.blockNumber);
    console.log("Gas used:", receipt?.gasUsed?.toString());

    const pendingDepositCountAfter = await depositLedger.pendingDepositCount();
    console.log("Pending deposit count after:", pendingDepositCountAfter.toString());
    console.log("=".repeat(80));
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
