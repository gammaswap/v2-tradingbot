import "dotenv/config";
import { ethers } from "ethers";
import { deriveAccountsFromMnemonic, DEPOSIT_LEDGER_ABI } from "@gammaswap/v2-exchange-sdk";

const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const TEST_MNEMONIC =
    process.env.TEST_MNEMONIC ||
    "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const DEPOSIT_LEDGER_CONTRACT =
    process.env.DEPOSIT_LEDGER_CONTRACT ||
    "0x0000000000000000000000000000000000000000";
const DEPOSIT_AMOUNT = 1_000_000_000n;

async function main() {
    console.log("=".repeat(80));
    console.log("DepositLedger deposit() Test");
    console.log("=".repeat(80));
    console.log("RPC_URL:", RPC_URL);
    console.log("CHAIN_ID:", CHAIN_ID);
    console.log("DEPOSIT_LEDGER_CONTRACT:", DEPOSIT_LEDGER_CONTRACT);
    console.log("WALLET_INDEX:", WALLET_INDEX);
    console.log("DEPOSIT_AMOUNT:", DEPOSIT_AMOUNT.toString());

    const account = deriveAccountsFromMnemonic(TEST_MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using wallet:", account.address);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const depositLedger = new ethers.Contract(DEPOSIT_LEDGER_CONTRACT, DEPOSIT_LEDGER_ABI, wallet);

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
