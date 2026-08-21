import { CFG } from "./config/config.js";
import { isBigIntString, log, sleep, warn } from "./utils/utils.js";
import {
    cleanUpAllOrders,
} from "./runtime/loops.js";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";
import { Wallet, isAddress } from "ethers";
import { STATE } from "./runtime/state.js";
import { apiGetAsset, apiGetBalance, apiGetPosition } from "./api/api.js";
import { startOracleFeed, type OracleFeed } from "./runtime/oracle.js";
import { startOrderBookFeed, type OrderBookFeed } from "./runtime/orderbook.js";
import { RuntimeEventQueue } from "./runtime/events.js";
import { runRuntimeCoordinator } from "./runtime/coordinator.js";

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
        ORDERBOOK_WS_URL: CFG.ORDERBOOK_WS_URL,
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

    const asset = await apiGetAsset();
    if(!asset.registered) {
        warn("ASSET_ID is unregistered!:", CFG.ASSET_ID);
        return;
    }

    log("API_URL:", CFG.API_URL)

    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    const wallet = new Wallet(account.privateKey);
    console.log("Using address :", wallet.address);

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

    const queue = new RuntimeEventQueue();
    const oracle = await startOracleFeed(queue);
    const orderbook = await startOrderBookFeed(queue);
    registerShutdown(oracle, orderbook);

    if (CFG.USE_ORACLE_FAIR_VALUE) {
        const gotFirstPrice = await oracle.waitForFirstPrice(CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS);
        if (!gotFirstPrice && CFG.REQUIRE_FRESH_FAIR_VALUE) {
            warn("No oracle price received before timeout; stopping because REQUIRE_FRESH_FAIR_VALUE is enabled.");
            await Promise.all([oracle.close(), orderbook.close()]);
            return;
        }
        if (!gotFirstPrice) warn("No oracle price received before timeout; falling back to book mid until one arrives.");
    }

    await runRuntimeCoordinator(wallet, queue);
}

function registerShutdown(oracle: OracleFeed, orderbook: OrderBookFeed) {
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("received", signal, "closing websocket feeds");
        void Promise.all([oracle.close(), orderbook.close()]).finally(() => process.exit(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
});
