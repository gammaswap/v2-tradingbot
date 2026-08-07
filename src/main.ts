import { CFG } from "./config/config.js";
import { isBigIntString, log, sleep, warn } from "./utils/utils.js";
import {
    cleanUpAllOrders,
    runAggression,
    runAssetEpochCheck,
    runBookRefresh,
    runCancelRebalance,
    runPendingRefresh,
    runQuoteMaintenance,
} from "./runtime/loops.js";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { Wallet, isAddress } from "ethers";
import { getAssetById, isAssetRegistered } from "./chain/blockchain.js";
import { STATE } from "./runtime/state.js";
import { apiGetBalance, apiGetPosition } from "./api/api.js";
import { Asset } from "./utils/types.js";
import { startOracleFeed, type OracleFeed } from "./runtime/oracle.js";

async function main() {
    log("starting bot", {
        LEVELS_PER_SIDE: CFG.LEVELS_PER_SIDE,
        WIPE_LEVELS: CFG.WIPE_LEVELS,
        TICK_SIZE: CFG.TICK_SIZE,
        INV_MAX_ABS: CFG.INV_MAX_ABS,
        EXCHANGE_ADDRESS: CFG.EXCHANGE_ADDRESS,
        LEDGER_ADDRESS: CFG.LEDGER_ADDRESS,
        ASSET_ID: CFG.ASSET_ID,
        API_URL: CFG.API_URL,
        ORACLE_FEED_WS_URL: CFG.ORACLE_FEED_WS_URL,
        SYMBOL_ID: CFG.SYMBOL_ID,
        USE_ORACLE_FAIR_VALUE: CFG.USE_ORACLE_FAIR_VALUE,
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

    log("API_URL:", CFG.API_URL)

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address :", wallet.address);

    const asset: Asset = await getAssetById(BigInt(CFG.ASSET_ID));
    STATE.asset = asset;
    STATE.epoch = asset.epoch;
    log("asset:", asset);

    await cleanUpAllOrders(wallet);

    await sleep(1000 * 3);

    const resp = await apiGetBalance();
    if(resp.pending >= CFG.DUST_BALANCE) {
        warn("Error: Pending balance > 0, pending:", resp.pending);
        return;
    }

    const position = await apiGetPosition(Number(STATE.epoch));
    STATE.invBase = Number(position.balance) * (position.bSide ? -1 : 1)
    console.log("invBase:", STATE.invBase);
    STATE.baseBal = Number(resp.balance);
    console.log("userBalance:", STATE.baseBal);

    if (STATE.baseBal < CFG.BASE_RESERVE_MIN) warn("START_BASE_BAL < BASE_RESERVE_MIN; bot may refuse quotes.");

    const oracle = await startOracleFeed();
    registerShutdown(oracle);

    if (CFG.USE_ORACLE_FAIR_VALUE) {
        const gotFirstPrice = await oracle.waitForFirstPrice(CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS);
        if (!gotFirstPrice && CFG.REQUIRE_FRESH_FAIR_VALUE) {
            warn("No oracle price received before timeout; stopping because REQUIRE_FRESH_FAIR_VALUE is enabled.");
            await oracle.close();
            return;
        }
        if (!gotFirstPrice) warn("No oracle price received before timeout; falling back to book mid until one arrives.");
    }

    while (true) {
        if(await runAssetEpochCheck(wallet)) {
            await sleep(1000);
            await runBookRefresh();
            await runPendingRefresh(wallet);
            await runQuoteMaintenance(wallet);
            //await runCancelRebalance(wallet);
            await runAggression(wallet);
        } else {
            await sleep(1000);
        }
    }
}

function registerShutdown(oracle: OracleFeed) {
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("received", signal, "closing oracle websocket");
        void oracle.close().finally(() => process.exit(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
});
