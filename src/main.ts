import { CFG } from "./config/config.js";
import { log, warn } from "./utils/utils.js";
import {
    loopAggression,
    loopBookRefresh,
    loopCancelRebalance,
    loopPendingRefresh,
    loopQuoteMaintenance,
} from "./runtime/loops.js";
import { deriveAccountsFromMnemonic } from "./utils/eip712.js";
import { Wallet } from "ethers";

async function main() {
    log("starting bot", {
        LEVELS_PER_SIDE: CFG.LEVELS_PER_SIDE,
        WIPE_LEVELS: CFG.WIPE_LEVELS,
        TICK_SIZE: CFG.TICK_SIZE,
        RESERVES: { base: CFG.BASE_RESERVE_MIN, quote: CFG.QUOTE_RESERVE_MIN },
        INV_MAX_ABS: CFG.INV_MAX_ABS,
        endpoints: {
            orders: CFG.ORDERS_URL,
            cancels: CFG.CANCELS_URL,
            book: CFG.BOOK_URL,
            pending: CFG.PENDING_URL,
        }
    });

    if (CFG.START_BASE_BAL < CFG.BASE_RESERVE_MIN) warn("START_BASE_BAL < BASE_RESERVE_MIN; bot may refuse asks.");
    if (CFG.START_QUOTE_BAL < CFG.QUOTE_RESERVE_MIN) warn("START_QUOTE_BAL < QUOTE_RESERVE_MIN; bot may refuse bids.");

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address :", wallet.address);

    await Promise.allSettled([
        loopBookRefresh(),
        loopPendingRefresh(wallet),
        loopQuoteMaintenance(wallet),
        loopCancelRebalance(wallet),
        loopAggression(wallet),
    ]);
}

main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
});
