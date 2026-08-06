import 'dotenv/config';
import { Wallet } from "ethers";
import axios from "axios";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";

const MNEMONIC = process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const BALANCE_ENDPOINT = process.env.BALANCE_ENDPOINT || "http://localhost:3000/balance";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0")

// run with "npx ts-node ./src/getBook.ts"
async function main() {
    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet:", wallet.address);

    try {
        const res = await axios.get(BALANCE_ENDPOINT + `/${wallet.address}`);
        console.log("Server response:", res.status, res.data);
    } catch (err: any) {
        if (err.response) {
            console.error(
                "Error response:",
                err.response.status,
                err.response.data
            );
        } else {
            console.error("Request error:", err.message);
        }
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
