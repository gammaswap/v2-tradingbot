import "dotenv/config";
import { Wallet } from "ethers";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { CFG, type Side } from "../config/config.js";
import { apiSendOrder } from "../api/api.js";

// run with "yarn order buy 100000000 500000"
// run with "yarn order sell 100000000 550000"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("API_URL:", CFG.API_URL);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address:", account.address);
    console.log("wallet:", wallet.address);

    const args = process.argv.slice(2);
    console.log("args:", args);

    let side: Side = "sell";
    let size = 100_000_000;
    let price = 530_000;

    if (args.length > 0 && args[0].toLowerCase() === "buy") {
        side = "buy";
    }
    if (args.length > 1 && Number(args[1]) > 0) {
        size = Math.floor(Number(args[1]));
    }
    if (args.length > 2 && Number(args[2]) > 0) {
        price = Math.floor(Number(args[2]));
    }

    const res = await apiSendOrder(wallet, {
        epoch: Number(CFG.EPOCH),
        side,
        price,
        size,
    });

    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
