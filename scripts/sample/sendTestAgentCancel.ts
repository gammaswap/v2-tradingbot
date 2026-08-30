import "dotenv/config";
import { Wallet, ZeroHash } from "ethers";
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
const AGENT_INDEX = Number(process.env.AGENT_INDEX || "1");
const ASSET_ID =
    process.env.ASSET_ID ||
    "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using account address:", account.address);

    const agent = deriveAccountsFromMnemonic(MNEMONIC, AGENT_INDEX + 1)[AGENT_INDEX];
    console.log("Using agent address:", agent.address);

    const wallet = new Wallet(agent.privateKey);
    console.log("wallet:", wallet.address);

    let orderHash: string;

    if (process.argv.length > 2) {
        orderHash = process.argv[2];
    } else {
        console.log("No orderHash provided");
        return;
    }

    console.log("orderId:", orderHash);

    const client = createExchangeClient({
        apiUrl: API_URL,
        wallet,
        chainId: CHAIN_ID,
    });

    const res =
        orderHash === "all" || orderHash === ZeroHash
            ? await client.cancelAllAgent({
                assetId: ASSET_ID,
                epoch: EPOCH,
                sender: account.address,
            })
            : await client.cancelAgentOrder({
                assetId: ASSET_ID,
                epoch: EPOCH,
                sender: account.address,
                orderHash,
            });

    console.log("signedAgentCancelMessage:", res.request);
    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
