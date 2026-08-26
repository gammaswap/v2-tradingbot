import { Wallet, isAddress } from "ethers";
import { CFG, validateProductionConfig } from "../config/config.js";
import { apiGetAsset, apiGetBalance, apiGetPosition } from "../api/api.js";
import { cleanUpAllOrders } from "./loops.js";
import { STATE, initializePeriodLength } from "./state.js";
import { RuntimeEventQueue } from "./events.js";
import { startOracleFeed, type OracleFeed } from "./oracle.js";
import { startOrderBookFeed, type OrderBookFeed } from "./orderbook.js";
import { runRuntimeCoordinator } from "./coordinator.js";
import { protocolValueToSafeNumber } from "../utils/protocolMath.js";
import { isBigIntString, log, sleep, warn } from "../utils/utils.js";

export type ContractAddresses = {
    exchange: string;
    ledger: string;
    settlementToken: string;
    permit2?: string;
    depositLedger?: string;
};

export type TradingBotOptions = {
    wallet: Wallet;
    apiUrl: string;
    assetId: string;
    chainId: number;
    contracts: ContractAddresses;
    orderbookWsUrl?: string;
    oracleFeedWsUrl?: string;
    oracleSymbolId?: string;
    quote?: {
        levelsPerSide?: number;
        ladderModel?: "equidistant" | "growth-space";
        logitHalfSpread?: number;
        quoteSizeConcavity?: number;
        tickSize?: number;
        lotSize?: number;
    };
    risk?: {
        maxContractExposurePct?: number;
        maxCapitalExposurePct?: number;
        maxOrderMarginPct?: number;
        inventoryTarget?: number;
        inventoryMaxAbs?: number;
    };
    timing?: {
        quoteLoopMs?: number;
        quoteJitterMs?: number;
        aggressionMs?: number;
        aggressionJitterMs?: number;
        bookStaleMs?: number;
        fairValueStaleMs?: number;
    };
    oracle?: {
        enabled?: boolean;
        requireFreshValue?: boolean;
        firstPriceTimeoutMs?: number;
    };
};

export type TradingBotStatus = {
    running: boolean;
    assetId: string;
    epoch: bigint;
    accountBalance: number;
    inventory: number;
    oracleConnected: boolean;
    bookConnected: boolean;
};

function applyOptions(options: TradingBotOptions): void {
    const overrides: Record<string, unknown> = {
        API_URL: options.apiUrl,
        ASSET_ID: options.assetId,
        CHAIN_ID: options.chainId,
        USER_ADDRESS: options.wallet.address,
        EXCHANGE_ADDRESS: options.contracts.exchange,
        LEDGER_ADDRESS: options.contracts.ledger,
        SETTLEMENT_TOKEN: options.contracts.settlementToken,
        PERMIT2_ADDRESS: options.contracts.permit2,
        DEPOSIT_LEDGER_ADDRESS: options.contracts.depositLedger,
        ORDERBOOK_WS_URL: options.orderbookWsUrl,
        ORACLE_FEED_WS_URL: options.oracleFeedWsUrl,
        SYMBOL_ID: options.oracleSymbolId,
        LEVELS_PER_SIDE: options.quote?.levelsPerSide,
        LADDER_PRICE_MODEL: options.quote?.ladderModel === "growth-space" ? 2 :
            options.quote?.ladderModel === "equidistant" ? 1 : undefined,
        LOGIT_HALF_SPREAD: options.quote?.logitHalfSpread,
        QUOTE_SIZE_CONCAVITY: options.quote?.quoteSizeConcavity,
        TICK_SIZE: options.quote?.tickSize,
        LOT_SIZE: options.quote?.lotSize,
        MAX_CONTRACT_EXPOSURE_PCT: options.risk?.maxContractExposurePct,
        MAX_CAPITAL_EXPOSURE_PERCENT: options.risk?.maxCapitalExposurePct,
        MAX_ORDER_MARGIN_PERCENT: options.risk?.maxOrderMarginPct,
        INV_TARGET: options.risk?.inventoryTarget,
        INV_MAX_ABS: options.risk?.inventoryMaxAbs,
        QUOTE_LOOP_MS: options.timing?.quoteLoopMs,
        QUOTE_JITTER_MS: options.timing?.quoteJitterMs,
        AGGRESS_MS: options.timing?.aggressionMs,
        AGGRESS_JITTER_MS: options.timing?.aggressionJitterMs,
        BOOK_STALE_MS: options.timing?.bookStaleMs,
        FAIR_VALUE_STALE_MS: options.timing?.fairValueStaleMs,
        USE_ORACLE_FAIR_VALUE: options.oracle?.enabled,
        REQUIRE_FRESH_FAIR_VALUE: options.oracle?.requireFreshValue,
        ORACLE_FIRST_PRICE_TIMEOUT_MS: options.oracle?.firstPriceTimeoutMs,
    };

    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) (CFG as any)[key] = value;
    }
}

export class TradingBot {
    private readonly wallet: Wallet;
    private readonly abortController = new AbortController();
    private coordinatorPromise: Promise<void> | null = null;
    private oracleFeed: OracleFeed | null = null;
    private orderBookFeed: OrderBookFeed | null = null;
    private running = false;

    /**
     * Creates a bot instance. The current runtime uses singleton CFG/STATE
     * objects, so only one TradingBot should run in a process at a time.
     */
    constructor(options: TradingBotOptions) {
        if (!options.apiUrl.trim()) throw new Error("apiUrl is required");
        if (!isBigIntString(options.assetId)) throw new Error("assetId must be an integer string");
        if (!Number.isSafeInteger(options.chainId) || options.chainId <= 0) {
            throw new Error("chainId must be a positive safe integer");
        }
        for (const [name, address] of Object.entries(options.contracts)) {
            if (address !== undefined && !isAddress(address)) {
                throw new Error(`${name} must be a valid address`);
            }
        }

        this.wallet = options.wallet;
        applyOptions(options);

        const errors = [
            ...validateProductionConfig({}),
        ];
        if (errors.length > 0) {
            throw new Error(`invalid trading bot configuration: ${errors.join("; ")}`);
        }
    }

    async start(): Promise<void> {
        if (this.running) throw new Error("trading bot is already running");

        const asset = await apiGetAsset();
        if (!asset.registered) throw new Error(`asset ${CFG.ASSET_ID} is not registered`);

        STATE.asset = asset;
        STATE.epoch = asset.epoch;
        initializePeriodLength(STATE, asset.assetId);

        await cleanUpAllOrders(this.wallet);
        await sleep(3_000);

        const balance = await apiGetBalance();
        if (balance.pending >= CFG.DUST_BALANCE) {
            throw new Error(`account has pending balance: ${balance.pending}`);
        }
        const position = await apiGetPosition(STATE.epoch);
        STATE.invBase = protocolValueToSafeNumber(position.balance, "position balance") *
            (position.bSide ? -1 : 1);
        STATE.accountBalance = protocolValueToSafeNumber(balance.balance, "account balance");
        STATE.baseBal = protocolValueToSafeNumber(
            balance.balance - balance.pending,
            "available base balance",
        );

        const queue = new RuntimeEventQueue();
        this.oracleFeed = await startOracleFeed(queue);
        this.orderBookFeed = await startOrderBookFeed(queue);

        if (CFG.USE_ORACLE_FAIR_VALUE) {
            const gotFirstPrice = await this.oracleFeed.waitForFirstPrice(
                CFG.ORACLE_FIRST_PRICE_TIMEOUT_MS,
            );
            if (!gotFirstPrice && CFG.REQUIRE_FRESH_FAIR_VALUE) {
                await this.stopFeeds();
                throw new Error("no fresh oracle price was received before timeout");
            }
        }

        this.running = true;
        this.coordinatorPromise = runRuntimeCoordinator(
            this.wallet,
            queue,
            this.abortController.signal,
        ).finally(() => {
            this.running = false;
        });
        log("trading bot started", { assetId: CFG.ASSET_ID, epoch: STATE.epoch.toString() });
    }

    async stop(): Promise<void> {
        if (!this.running && !this.coordinatorPromise) return;

        this.abortController.abort();
        await this.stopFeeds();
        await this.coordinatorPromise;
        this.coordinatorPromise = null;
        this.running = false;
    }

    getStatus(): TradingBotStatus {
        return {
            running: this.running,
            assetId: CFG.ASSET_ID,
            epoch: STATE.epoch,
            accountBalance: STATE.accountBalance,
            inventory: STATE.invBase,
            oracleConnected: STATE.oracle.connected,
            bookConnected: STATE.bookUpdatedAtMs > 0,
        };
    }

    private async stopFeeds(): Promise<void> {
        const feeds = [this.oracleFeed?.close(), this.orderBookFeed?.close()]
            .filter((promise): promise is Promise<void> => promise !== undefined);
        await Promise.allSettled(feeds);
        this.oracleFeed = null;
        this.orderBookFeed = null;
    }
}
