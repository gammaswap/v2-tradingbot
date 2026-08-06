import "dotenv/config";
import { Wallet } from "ethers";
import {
    createExchangeClient,
    deriveAccountsFromMnemonic,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
    process.env.TEST_MNEMONIC ||
    "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID =
    process.env.ASSET_ID ||
    "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet:", wallet.address);

    let epoch = EPOCH;

    if (process.argv.length > 2) {
        if (isNaN(Number(process.argv[2]))) {
            console.log("Invalid epoch provided");
            return;
        }
        epoch = process.argv[2];
    }

    console.log("epoch:", epoch);

    const client = createExchangeClient({
        apiUrl: API_URL,
        wallet,
        chainId: CHAIN_ID,
    });

    const res = await client.claim({
        assetId: ASSET_ID,
        epoch,
    });

    console.log("signedClaimMessage:", res.request);
    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
