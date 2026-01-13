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
import { getLedgerBalance, getPositionBalance } from "./chain/blockchain.js";
import { STATE } from "./runtime/state.js";

async function main() {
    log("starting bot", {
        LEVELS_PER_SIDE: CFG.LEVELS_PER_SIDE,
        WIPE_LEVELS: CFG.WIPE_LEVELS,
        TICK_SIZE: CFG.TICK_SIZE,
        INV_MAX_ABS: CFG.INV_MAX_ABS,
        endpoints: {
            orders: CFG.ORDERS_URL,
            cancels: CFG.CANCELS_URL,
            book: CFG.BOOK_URL,
            pending: CFG.PENDING_URL,
        }
    });

    if (CFG.START_BASE_BAL < CFG.BASE_RESERVE_MIN) warn("START_BASE_BAL < BASE_RESERVE_MIN; bot may refuse quotes.");

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address :", wallet.address);

    const position = await getPositionBalance(1n, wallet.address);
    STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1)
    console.log("invBase:", STATE.invBase);
    const userBalance = await getLedgerBalance(wallet.address);
    STATE.baseBal = Number(userBalance);
    console.log("userBalance:", STATE.baseBal);

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
