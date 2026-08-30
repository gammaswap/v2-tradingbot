import "dotenv/config";
import { Wallet } from "ethers";
import {
    createInfoClient,
    deriveAccountsFromMnemonic,
    HttpResponseError,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const MNEMONIC =
    process.env.MNEMONIC ||
    "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

// run with "pnpm sample:balance"
// or "pnpm sample:balance <account>"
async function main() {
    const client = createInfoClient({
        apiUrl: API_URL,
    });

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet:", wallet.address);

    let balanceAccount = wallet.address;
    const args = process.argv.slice(2);
    if (args.length > 0) {
        balanceAccount = args[0];
    }

    try {
        const res = await client.getBalance(balanceAccount);
        console.log("Server response:", res.status, res.data);
    } catch (err: unknown) {
        if (err instanceof HttpResponseError) {
            console.error("Error response:", err.status, err.data);
        } else if (err instanceof Error) {
            console.error("Request error:", err.message);
        } else {
            console.error("Request error:", err);
        }
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
