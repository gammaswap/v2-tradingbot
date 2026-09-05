import "dotenv/config";
import { Wallet } from "ethers";
import {
    createExchangeClient,
    deriveAccountsFromMnemonic,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const LEDGER_ADDRESS =
    process.env.LEDGER_CONTRACT ||
    "0x0000000000000000000000000000000000000000";
const MNEMONIC =
    process.env.MNEMONIC ||
    "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const WITHDRAWAL_AMOUNT = process.env.WITHDRAWAL_AMOUNT || "1000";

async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);
    console.log("LEDGER_ADDRESS:", LEDGER_ADDRESS);

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet:", wallet.address);

    const client = createExchangeClient({
        apiUrl: API_URL,
        wallet,
        chainId: CHAIN_ID,
    });

    const res = await client.withdraw({
        amount: WITHDRAWAL_AMOUNT,
        receiver: wallet.address,
    });

    console.log("signedWithdrawalMessage:", res.request);
    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
