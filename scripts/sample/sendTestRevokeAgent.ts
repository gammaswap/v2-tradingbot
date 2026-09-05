
import "dotenv/config";
import { Wallet } from "ethers";
import {
    createExchangeClient,
    deriveAccountsFromMnemonic,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
    process.env.MNEMONIC ||
    "test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using account address:", account.address);

    const wallet = new Wallet(account.privateKey);

    const client = createExchangeClient({
        apiUrl: API_URL,
        wallet,
        chainId: CHAIN_ID,
    });

    const res = await client.revokeAgent({});

    console.log("signedRevokeAgentMessage:", res.request);
    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
