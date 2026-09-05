
import "dotenv/config";
import { isAddress } from "ethers";
import {
    createInfoClient,
    deriveAccountsFromMnemonic,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const MNEMONIC =
    process.env.MNEMONIC ||
    "test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

async function main() {
    const client = createInfoClient({
        apiUrl: API_URL,
    });

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];

    let targetAccount = account.address;
    if (process.argv.length > 2) {
        if (!isAddress(process.argv[2])) {
            console.log("Invalid account provided");
            return;
        }

        targetAccount = process.argv[2];
    }

    console.log("Using address:", targetAccount);

    const res = await client.getAgentApproval(targetAccount);

    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
