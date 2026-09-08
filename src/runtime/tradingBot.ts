import { Wallet, isAddress } from "ethers";
import {
  validateOrderSizeConfiguration,
  validatePriceConfiguration,
  validateProductionConfig,
  validateRiskConfiguration,
  type AggressionModel,
} from "../config/config.js";
import { apiGetAsset, apiGetBalance, apiGetPosition } from "../api/api.js";
import { cancelAllOpenOrdersOnShutdown, cleanUpAllOrders } from "./loops.js";
import { initializePeriodLength } from "./state.js";
import { RuntimeEventQueue } from "./events.js";
import { startOracleFeed, type OracleFeed } from "./oracle.js";
import { startOrderBookFeed, type OrderBookFeed } from "./orderbook.js";
import { runRuntimeCoordinator } from "./coordinator.js";
import { protocolValueToSafeNumber } from "../utils/protocolMath.js";
import { clamp, isBigIntString, sleep } from "../utils/utils.js";
import { resolveTradingWallet } from "./wallet.js";
import { Logger, type LogLevel } from "../utils/logger.js";
import {
  createBotContext,
  runWithBotContext,
  RUNTIME_CFG as CFG,
  RUNTIME_STATE as STATE,
  type BotContext,
} from "./context.js";
import { startControlServer, type ControlServer } from "./controlServer.js";

const logger = new Logger("tradingBot");

export type ContractAddresses = {
  exchange: string;
  ledger: string;
  settlementToken: string;
  permit2?: string;
  depositLedger?: string;
};

export type TradingBotOptions = {
  wallet?: Wallet;
  logLevel?: LogLevel;
  isTaker?: boolean;
  apiUrl: string;
  api?: {
    key?: string;
    secret?: string;
    timeoutMs?: number;
  };
  assetId: string;
  controlSocketPath?: string;
  chainId: number;
  contracts: ContractAddresses;
  orderbookWsUrl?: string;
  bookStaleMs?: number;
  hardMinPrice?: number;
  hardMaxPrice?: number;
  dustBalance?: bigint;
  maxOrderSize?: number;
  quote?: {
    quoteLoopMs?: number;
    quoteJitterMs?: number;
    orderFailureCooldownMs?: number;
    riskAversionGamma0?: number;
    riskAversionGammaMax?: number;
    riskAversionB?: number;
    totalSizeDecayK?: number;
    totalSizeDecayA?: number;
    totalSizeTimeBucketSeconds?: number;
    levelsPerSide?: number;
    ladderModel?: "equidistant" | "growth-space";
    levelSpacingNear?: number;
    levelSpacingGrowth?: number;
    logitHalfSpread?: number;
    quoteSizeConcavity?: number;
  };
  risk?: {
    maxContractExposurePct?: number;
    maxCapitalExposurePct?: number;
    baseReserveMin?: number;
    inventoryTarget?: number;
    inventoryMaxAbs?: number;
  };
  fairValue?: {
    fairValueStaleMs?: number;
    oracleFeedWsUrl?: string;
    enabled?: boolean;
    requireFreshValue?: boolean;
    stalePriceTimeoutMs?: number;
    firstPriceTimeoutMs?: number;
    volatility?: number;
    weight?: number;
    paysAboveStrike?: boolean;
  };
  aggression?: {
    model?: AggressionModel;
    aggressionMs?: number;
    aggressionJitterMs?: number;
    fairValueMinEdgeTicks?: number;
    wipeLevels?: number;
    slipBuffer?: number;
    maxAggressQty?: number;
    meanReversionK?: number;
    inventorySkewStrength?: number;
    extremePushProbability?: number;
  };
};

export type TradingBotStatus = {
  running: boolean;
  assetId: string;
  epoch: string;
  expiration: string | null;
  isResolved: boolean;
  referencePrice: number | null;
  fairValue: {
    protocolPrice: number;
    probability: number;
    spot: string;
    strike: string;
    expiresInSec: number;
    updatedAtMs: number;
  } | null;
  oracle: {
    price: string | null;
    ts: string | null;
    stale: boolean;
    connected: boolean;
  };
  bookMid: number | null;
  bookUpdatedAtMs: number;
  pendingOrders: number;
  quoteModel: {
    updatedAtMs: number;
    bookMid: number;
    referencePrice: number;
    gamma: number;
    inventorySkew: number;
    calculatedBid: number;
    calculatedAsk: number;
    calculatedMid: number;
    bidSize: number;
    askSize: number;
  } | null;
  accountBalance: number;
  inventory: number;
  oracleConnected: boolean;
  bookConnected: boolean;
};

/*
 * The options above intentionally group timing controls with the subsystem
 * whose behavior they affect. Keep this mapping centralized so constructor
 * overrides continue to use the same validation and defaults as environment
 * configuration.
 */
function getOptionOverrides(options: TradingBotOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    LOG_LEVEL: options.logLevel,
    IS_TAKER: options.isTaker,
    API_URL: options.apiUrl,
    API_KEY: options.api?.key,
    API_SECRET: options.api?.secret,
    API_TIMEOUT_MS: options.api?.timeoutMs,
    ASSET_ID: options.assetId,
    CHAIN_ID: options.chainId,
    EXCHANGE_ADDRESS: options.contracts.exchange,
    LEDGER_ADDRESS: options.contracts.ledger,
    SETTLEMENT_TOKEN: options.contracts.settlementToken,
    PERMIT2_ADDRESS: options.contracts.permit2,
    DEPOSIT_LEDGER_ADDRESS: options.contracts.depositLedger,
    ORDERBOOK_WS_URL: options.orderbookWsUrl,
    BOOK_STALE_MS: options.bookStaleMs,
    HARD_MIN_PRICE: options.hardMinPrice,
    HARD_MAX_PRICE: options.hardMaxPrice,
    DUST_BALANCE: options.dustBalance,
    MAX_ORDER_SIZE: options.maxOrderSize,
    QUOTE_LOOP_MS: options.quote?.quoteLoopMs,
    QUOTE_JITTER_MS: options.quote?.quoteJitterMs,
    ORDER_FAILURE_COOLDOWN_MS: options.quote?.orderFailureCooldownMs,
    RISK_AVERSION_GAMMA_0: options.quote?.riskAversionGamma0,
    RISK_AVERSION_GAMMA_MAX: options.quote?.riskAversionGammaMax,
    RISK_AVERSION_B: options.quote?.riskAversionB,
    TOTAL_SIZE_DECAY_K: options.quote?.totalSizeDecayK,
    TOTAL_SIZE_DECAY_A: options.quote?.totalSizeDecayA,
    TOTAL_SIZE_TIME_BUCKET_SECONDS: options.quote?.totalSizeTimeBucketSeconds,
    LEVELS_PER_SIDE: options.quote?.levelsPerSide,
    LADDER_PRICE_MODEL:
      options.quote?.ladderModel === "growth-space"
        ? 2
        : options.quote?.ladderModel === "equidistant"
          ? 1
          : undefined,
    LOGIT_HALF_SPREAD: options.quote?.logitHalfSpread,
    QUOTE_SIZE_CONCAVITY: options.quote?.quoteSizeConcavity,
    LEVEL_SPACING_NEAR: options.quote?.levelSpacingNear,
    LEVEL_SPACING_GROWTH: options.quote?.levelSpacingGrowth,
    MAX_CONTRACT_EXPOSURE_PCT: options.risk?.maxContractExposurePct,
    MAX_CAPITAL_EXPOSURE_PERCENT: options.risk?.maxCapitalExposurePct,
    BASE_RESERVE_MIN: options.risk?.baseReserveMin,
    INV_TARGET: options.risk?.inventoryTarget,
    INV_MAX_ABS: options.risk?.inventoryMaxAbs,
    FAIR_VALUE_STALE_MS: options.fairValue?.fairValueStaleMs,
    ORACLE_FEED_WS_URL: options.fairValue?.oracleFeedWsUrl,
    USE_ORACLE_FAIR_VALUE: options.fairValue?.enabled,
    REQUIRE_FRESH_FAIR_VALUE: options.fairValue?.requireFreshValue,
    ORACLE_STALE_PRICE_TIMEOUT_MS: options.fairValue?.stalePriceTimeoutMs,
    ORACLE_FIRST_PRICE_TIMEOUT_MS: options.fairValue?.firstPriceTimeoutMs,
    FAIR_VALUE_VOL: options.fairValue?.volatility,
    FAIR_VALUE_WEIGHT:
      options.fairValue?.weight === undefined ? undefined : clamp(options.fairValue.weight, 0, 1),
    FAIR_VALUE_PAYS_ABOVE_STRIKE: options.fairValue?.paysAboveStrike,
    AGGRESS_MS: options.aggression?.aggressionMs,
    AGGRESS_JITTER_MS: options.aggression?.aggressionJitterMs,
    AGGRESSION_MODEL: options.aggression?.model,
    FAIR_VALUE_MIN_EDGE_TICKS: options.aggression?.fairValueMinEdgeTicks,
    WIPE_LEVELS: options.aggression?.wipeLevels,
    SLIP_BUFFER: options.aggression?.slipBuffer,
    MAX_AGGRESS_QTY: options.aggression?.maxAggressQty,
    MEANREV_K: options.aggression?.meanReversionK,
    INV_SKEW_STRENGTH: options.aggression?.inventorySkewStrength,
    EXTREME_PUSH_PROB: options.aggression?.extremePushProbability,
  };

  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
}

export class TradingBot {
  private readonly wallet: Wallet;
  private readonly context: BotContext;
  private readonly controlSocketPath?: string;
  private readonly abortController = new AbortController();
  private coordinatorPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private oracleFeed: OracleFeed | null = null;
  private orderBookFeed: OrderBookFeed | null = null;
  private running = false;
  private controlServer: ControlServer | null = null;

  /**
   * Creates a bot instance with isolated configuration, state, intents, and
   * cooldowns. Websocket feeds remain owned by this instance.
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

    this.wallet = resolveTradingWallet(options.wallet);
    this.controlSocketPath = options.controlSocketPath;
    this.context = createBotContext(getOptionOverrides(options));
    this.context.state.account = this.wallet.address;

    const errors = [
      ...validatePriceConfiguration(this.context.config),
      ...validateOrderSizeConfiguration(this.context.config),
      ...validateRiskConfiguration(this.context.config),
      ...validateProductionConfig({}),
    ];
    if (errors.length > 0) {
      throw new Error(`invalid trading bot configuration: ${errors.join("; ")}`);
    }
  }

  async start(): Promise<void> {
    return runWithBotContext(this.context, () => this.startInContext());
  }

  private async startInContext(): Promise<void> {
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
    STATE.invBase =
      protocolValueToSafeNumber(position.balance, "position balance") * (position.bSide ? -1 : 1);
    STATE.accountBalance = protocolValueToSafeNumber(balance.balance, "account balance");
    STATE.baseBal = protocolValueToSafeNumber(
      balance.balance - balance.pending,
      "available base balance",
    );

    const queue = new RuntimeEventQueue();
    // This call is unconditional so the bot always owns an OracleFeed
    // with close() and waitForFirstPrice(). startOracleFeed() returns a
    // no-op feed when USE_ORACLE_FAIR_VALUE is false, so no oracle
    // websocket is started in that mode.
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

    if (this.controlSocketPath) {
      this.controlServer = await startControlServer({
        socketPath: this.controlSocketPath,
        getStatus: () => this.getStatus(),
      });
    }
    this.running = true;
    this.coordinatorPromise = runRuntimeCoordinator(
      this.wallet,
      queue,
      this.abortController.signal,
      this.context,
    ).finally(() => {
      this.running = false;
    });
    logger.info("trading bot started", { assetId: CFG.ASSET_ID, epoch: STATE.epoch.toString() });
  }

  async stop(): Promise<void> {
    if (!this.running && !this.coordinatorPromise) return;
    if (!this.shutdownPromise) {
      this.shutdownPromise = runWithBotContext(this.context, () => this.stopInContext());
    }
    return this.shutdownPromise;
  }

  private async stopInContext(): Promise<void> {
    logger.info("stopping trading bot");
    this.abortController.abort();

    // Wait for an in-flight coordinator pass so it cannot submit new work
    // concurrently with the shutdown cancel-all request.
    try {
      await this.coordinatorPromise;
    } catch (error) {
      logger.warn("coordinator stopped with an error:", error);
    }

    await this.stopFeeds();

    // Cancel-all is best effort and bounded. A failure is logged, but it
    // must not prevent websocket cleanup or the process from exiting.
    try {
      await cancelAllOpenOrdersOnShutdown(this.wallet, STATE.epoch);
    } catch (error) {
      logger.error("failed to cancel open orders during shutdown:", error);
    }

    this.coordinatorPromise = null;
    this.running = false;
    await this.controlServer?.close();
    this.controlServer = null;
    logger.info("trading bot stopped");
  }

  getStatus(): TradingBotStatus {
    const { config, state } = this.context;
    return {
      running: this.running,
      assetId: config.ASSET_ID,
      epoch: state.epoch.toString(),
      expiration: state.asset?.expiration?.toString() ?? null,
      isResolved: state.asset?.isResolved ?? false,
      referencePrice: state.fairValue?.protocolPrice ?? state.lastMid ?? null,
      fairValue: state.fairValue
        ? {
            ...state.fairValue,
            spot: state.fairValue.spot.toString(),
            strike: state.fairValue.strike.toString(),
          }
        : null,
      oracle: {
        price: state.oracle.price?.toString() ?? null,
        ts: state.oracle.ts?.toString() ?? null,
        stale: state.oracle.stale,
        connected: state.oracle.connected,
      },
      bookMid: state.lastMid ?? null,
      bookUpdatedAtMs: state.bookUpdatedAtMs,
      pendingOrders: state.pending.size,
      quoteModel: state.quoteModel,
      accountBalance: state.accountBalance,
      inventory: state.invBase,
      oracleConnected: state.oracle.connected,
      bookConnected: state.bookUpdatedAtMs > 0,
    };
  }

  private async stopFeeds(): Promise<void> {
    const feeds = [this.oracleFeed?.close(), this.orderBookFeed?.close()].filter(
      (promise): promise is Promise<void> => promise !== undefined,
    );
    await Promise.allSettled(feeds);
    this.oracleFeed = null;
    this.orderBookFeed = null;
  }
}
