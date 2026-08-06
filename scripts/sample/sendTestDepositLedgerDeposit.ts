import "dotenv/config";
import { Wallet } from "ethers";
import {
    createDepositClient,
    deriveAccountsFromMnemonic,
} from "@gammaswap/v2-exchange-sdk";

const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const TEST_MNEMONIC =
    process.env.TEST_MNEMONIC ||
    "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const DEPOSIT_LEDGER_CONTRACT = process.env.DEPOSIT_LEDGER_CONTRACT;
const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT || "1000";

async function main() {
    console.log("=".repeat(80));
    console.log("DepositLedger deposit() SDK sample");
    console.log("=".repeat(80));
    console.log("RPC_URL:", RPC_URL);
    console.log("CHAIN_ID:", CHAIN_ID);
    console.log("DEPOSIT_LEDGER_CONTRACT:", DEPOSIT_LEDGER_CONTRACT);
    console.log("WALLET_INDEX:", WALLET_INDEX);
    console.log("DEPOSIT_AMOUNT:", DEPOSIT_AMOUNT);

    const account = deriveAccountsFromMnemonic(TEST_MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using wallet:", account.address);

    const wallet = new Wallet(account.privateKey);

    const client = createDepositClient({
        rpcUrl: RPC_URL,
        wallet,
        chainId: CHAIN_ID,
        ...(DEPOSIT_LEDGER_CONTRACT === undefined
            ? {}
            : { depositLedger: DEPOSIT_LEDGER_CONTRACT }),
    });

    const settlementToken = await client.getSettlementToken();
    const accountLedger = await client.getAccountLedger();
    const pendingDepositCountBefore = await client.getPendingDepositCount();

    console.log("Settlement token:", settlementToken);
    console.log("Account ledger:", accountLedger);
    console.log("Pending deposit count before:", pendingDepositCountBefore.toString());

    const res = await client.deposit({
        amount: DEPOSIT_AMOUNT,
        logTxId: true,
    });

    console.log("Transaction hash:", res.tx.hash);
    console.log("Confirmed in block:", res.receipt.blockNumber);
    console.log("Gas used:", res.receipt.gasUsed.toString());

    const pendingDepositCountAfter = await client.getPendingDepositCount();
    console.log("Pending deposit count after:", pendingDepositCountAfter.toString());
    console.log("=".repeat(80));
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
