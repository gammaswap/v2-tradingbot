import "dotenv/config";
import { Wallet } from "ethers";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { CFG } from "../config/config.js";
import { apiClaim } from "../api/api.js";

// run with "yarn claim" or "yarn claim <epoch>"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("API_URL:", CFG.API_URL);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address:", account.address);
    console.log("wallet:", wallet.address);

    let epoch = Number(CFG.EPOCH);
    if (process.argv.length > 2) {
        if (isNaN(Number(process.argv[2]))) {
            console.log("Invalid epoch provided");
            return;
        }
        epoch = Number(process.argv[2]);
    }

    console.log("epoch:", epoch);
    const res = await apiClaim(wallet, epoch);
    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
