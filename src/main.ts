import { CFG } from "./config/config.js";
import { isBigIntString, log, warn } from "./utils/utils.js";
import {
    loopAggression,
    loopBookRefresh,
    loopCancelRebalance,
    loopPendingRefresh,
    loopQuoteMaintenance,
} from "./runtime/loops.js";
import { deriveAccountsFromMnemonic } from "./utils/eip712.js";
import { Wallet, isAddress } from "ethers";
import { getLedgerBalance, getPositionBalance, isAssetRegistered } from "./chain/blockchain.js";
import { STATE } from "./runtime/state.js";

async function main() {
    log("starting bot", {
        LEVELS_PER_SIDE: CFG.LEVELS_PER_SIDE,
        WIPE_LEVELS: CFG.WIPE_LEVELS,
        TICK_SIZE: CFG.TICK_SIZE,
        INV_MAX_ABS: CFG.INV_MAX_ABS,
        EXCHANGE_ADDRESS: CFG.EXCHANGE_ADDRESS,
        LEDGER_ADDRESS: CFG.LEDGER_ADDRESS,
        ASSET_ID: CFG.ASSET_ID,
        endpoints: {
            orders: CFG.ORDERS_URL,
            cancels: CFG.CANCELS_URL,
            book: CFG.BOOK_URL,
            pending: CFG.PENDING_URL,
        }
    });

    if(!isAddress(CFG.EXCHANGE_ADDRESS) || CFG.EXCHANGE_ADDRESS == "0x0000000000000000000000000000000000000000") {
        warn("EXCHANGE_ADDRESS is invalid!:", CFG.EXCHANGE_ADDRESS);
        return;
    }
    if(!isAddress(CFG.LEDGER_ADDRESS) || CFG.LEDGER_ADDRESS == "0x0000000000000000000000000000000000000000") {
        warn("LEDGER_ADDRESS is invalid!:", CFG.LEDGER_ADDRESS);
        return;
    }

    if(!CFG.ASSET_ID || !isBigIntString(CFG.ASSET_ID)) {
        warn("ASSET_ID is invalid!:", CFG.ASSET_ID);
        return;
    }

    if(!await isAssetRegistered(BigInt(CFG.ASSET_ID))) {
        warn("ASSET_ID is unregistered!:", CFG.ASSET_ID);
        return;
    }

    log("endpoints:", {
        orders: CFG.ORDERS_URL,
        cancels: CFG.CANCELS_URL,
    })

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address :", wallet.address);

    const position = await getPositionBalance(1n, wallet.address);
    STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1)
    console.log("invBase:", STATE.invBase);
    const userBalance = await getLedgerBalance(wallet.address);
    STATE.baseBal = Number(userBalance);
    console.log("userBalance:", STATE.baseBal);

    if (STATE.baseBal < CFG.BASE_RESERVE_MIN) warn("START_BASE_BAL < BASE_RESERVE_MIN; bot may refuse quotes.");

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
