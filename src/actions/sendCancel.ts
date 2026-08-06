import "dotenv/config";
import { Wallet, ZeroHash } from "ethers";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { CFG } from "../config/config.js";
import { apiCancelOrder } from "../api/api.js";

// run with "yarn cancel <orderHash>" or "yarn cancel all"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("API_URL:", CFG.API_URL);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address:", account.address);
    console.log("wallet:", wallet.address);

    if (process.argv.length <= 2) {
        console.log("No orderHash provided");
        return;
    }

    const orderHash = process.argv[2];
    console.log("orderId:", orderHash);

    const res = await apiCancelOrder(
        wallet,
        Number(CFG.EPOCH),
        orderHash === "all" ? ZeroHash : orderHash,
    );

    console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
