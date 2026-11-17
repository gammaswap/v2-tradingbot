import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import {
  TradingBot,
  validateTradingBotOptions,
  type TradingBotOptions,
} from "../src/runtime/tradingBot.js";

describe("TradingBot options", () => {
  const createOptions = (
    weight: number,
    fairValue: TradingBotOptions["fairValue"] = {},
  ): TradingBotOptions => ({
    wallet: Wallet.createRandom() as unknown as Wallet,
    apiUrl: "https://example.com/api",
    assetId: "1",
    chainId: 1,
    contracts: {
      exchange: "0x1111111111111111111111111111111111111111",
      ledger: "0x2222222222222222222222222222222222222222",
      settlementToken: "0x3333333333333333333333333333333333333333",
    },
    fairValue: { weight, ...fairValue },
  });

  const createBot = (weight: number) => new TradingBot(createOptions(weight));

  it("uses the default oracle notification threshold and interval", () => {
    const bot = createBot(1);

    expect((bot as any).context.config.ORACLE_NOTIFY_MIN_CHANGE_TICKS).toBe(2);
    expect((bot as any).context.config.ORACLE_NOTIFY_INTERVAL_MS).toBe(500);
  });

  it.each([
    ["notifyMinChangeTicks", 0, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyMinChangeTicks", -1, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyMinChangeTicks", 1.5, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyMinChangeTicks", NaN, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyMinChangeTicks", Infinity, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyMinChangeTicks", Number.MAX_SAFE_INTEGER + 1, "ORACLE_NOTIFY_MIN_CHANGE_TICKS"],
    ["notifyIntervalMs", 0, "ORACLE_NOTIFY_INTERVAL_MS"],
    ["notifyIntervalMs", -1, "ORACLE_NOTIFY_INTERVAL_MS"],
    ["notifyIntervalMs", NaN, "ORACLE_NOTIFY_INTERVAL_MS"],
    ["notifyIntervalMs", Infinity, "ORACLE_NOTIFY_INTERVAL_MS"],
  ] as const)("rejects %s=%s before startup", (name, value, configName) => {
    const options = createOptions(1, { [name]: value });

    expect(validateTradingBotOptions(options)).toEqual(
      expect.arrayContaining([expect.stringContaining(configName)]),
    );
    expect(() => new TradingBot(options)).toThrow(configName);
  });

  it.each([
    [{ quote: { quoteLoopMs: 0 } }, "QUOTE_LOOP_MS"],
    [{ fairValue: { volatility: -0.1 } }, "FAIR_VALUE_VOL"],
    [{ risk: { inventoryMaxAbs: NaN } }, "INV_MAX_ABS"],
    [{ aggression: { extremePushProbability: 1.1 } }, "EXTREME_PUSH_PROB"],
  ] as const)("rejects invalid strategy overrides %j", (overrides, configName) => {
    const options = { ...createOptions(1), ...overrides };

    expect(() => new TradingBot(options)).toThrow(configName);
  });

  it("accepts an oracle stale-price timeout override", () => {
    const bot = new TradingBot({
      wallet: Wallet.createRandom() as unknown as Wallet,
      logLevel: "debug",
      isTaker: true,
      apiUrl: "https://example.com/api",
      api: {
        key: "constructor-api-key",
        secret: "constructor-api-secret",
        timeoutMs: 12_345,
      },
      assetId: "1",
      chainId: 1,
      contracts: {
        exchange: "0x1111111111111111111111111111111111111111",
        ledger: "0x2222222222222222222222222222222222222222",
        settlementToken: "0x3333333333333333333333333333333333333333",
      },
      orderbookWsUrl: "wss://example.com/orderbook",
      bookStaleMs: 11_111,
      hardMinPrice: 2_000,
      hardMaxPrice: 998_000,
      dustBalance: 654_321n,
      maxOrderSize: 80_000_000_000,
      fairValue: {
        oracleFeedWsUrl: "wss://example.com/oracle",
        enabled: true,
        requireFreshValue: true,
        stalePriceTimeoutMs: 23_456,
        firstPriceTimeoutMs: 34_567,
        notifyMinChangeTicks: 4,
        notifyIntervalMs: 1_250,
        fairValueStaleMs: 45_678,
        volatility: 0.9,
        weight: 0.8,
        paysAboveStrike: false,
      },
      quote: {
        quoteLoopMs: 5_000,
        quoteJitterMs: 250,
        orderFailureCooldownMs: 15_000,
        riskAversionGamma0: 2e-9,
        riskAversionGammaMax: 2e-8,
        riskAversionB: 4,
        totalSizeDecayK: 2.5,
        totalSizeDecayA: 0.75,
        totalSizeTimeBucketSeconds: 10,
        levelSpacingNear: 2_500,
        levelSpacingGrowth: 1.75,
      },
      aggression: {
        model: "edge",
        aggressionMs: 6_000,
        aggressionJitterMs: 300,
        fairValueMinEdgeTicks: 3,
        wipeLevels: 4,
        slipBuffer: 0.2,
        maxAggressQty: 400_000_000,
        meanReversionK: 3,
        inventorySkewStrength: 0.5,
        extremePushProbability: 0.15,
      },
      risk: {
        baseReserveMin: 123_456,
      },
    });

    expect(bot).toBeInstanceOf(TradingBot);
    expect((bot as any).context.config.API_KEY).toBe("constructor-api-key");
    expect((bot as any).context.config.LOG_LEVEL).toBe("debug");
    expect((bot as any).context.config.IS_TAKER).toBe(true);
    expect((bot as any).context.config.API_SECRET).toBe("constructor-api-secret");
    expect((bot as any).context.config.API_TIMEOUT_MS).toBe(12_345);
    expect((bot as any).context.config.ORDERBOOK_WS_URL).toBe("wss://example.com/orderbook");
    expect((bot as any).context.config.BOOK_STALE_MS).toBe(11_111);
    expect((bot as any).context.config.HARD_MIN_PRICE).toBe(2_000);
    expect((bot as any).context.config.HARD_MAX_PRICE).toBe(998_000);
    expect((bot as any).context.config.DUST_BALANCE).toBe(654_321n);
    expect((bot as any).context.config.MAX_ORDER_SIZE).toBe(80_000_000_000);
    expect((bot as any).context.config.ORACLE_STALE_PRICE_TIMEOUT_MS).toBe(23_456);
    expect((bot as any).context.config.ORACLE_NOTIFY_MIN_CHANGE_TICKS).toBe(4);
    expect((bot as any).context.config.ORACLE_NOTIFY_INTERVAL_MS).toBe(1_250);
    expect((bot as any).context.config.FAIR_VALUE_STALE_MS).toBe(45_678);
    expect((bot as any).context.config.ORACLE_FEED_WS_URL).toBe("wss://example.com/oracle");
    expect((bot as any).context.config.FAIR_VALUE_VOL).toBe(0.9);
    expect((bot as any).context.config.FAIR_VALUE_WEIGHT).toBe(0.8);
    expect((bot as any).context.config.FAIR_VALUE_PAYS_ABOVE_STRIKE).toBe(false);
    expect((bot as any).context.config.QUOTE_LOOP_MS).toBe(5_000);
    expect((bot as any).context.config.QUOTE_JITTER_MS).toBe(250);
    expect((bot as any).context.config.ORDER_FAILURE_COOLDOWN_MS).toBe(15_000);
    expect((bot as any).context.config.RISK_AVERSION_GAMMA_0).toBe(2e-9);
    expect((bot as any).context.config.RISK_AVERSION_GAMMA_MAX).toBe(2e-8);
    expect((bot as any).context.config.RISK_AVERSION_B).toBe(4);
    expect((bot as any).context.config.TOTAL_SIZE_DECAY_K).toBe(2.5);
    expect((bot as any).context.config.TOTAL_SIZE_DECAY_A).toBe(0.75);
    expect((bot as any).context.config.TOTAL_SIZE_TIME_BUCKET_SECONDS).toBe(10);
    expect((bot as any).context.config.LEVEL_SPACING_NEAR).toBe(2_500);
    expect((bot as any).context.config.LEVEL_SPACING_GROWTH).toBe(1.75);
    expect((bot as any).context.config.AGGRESS_MS).toBe(6_000);
    expect((bot as any).context.config.AGGRESS_JITTER_MS).toBe(300);
    expect((bot as any).context.config.AGGRESSION_MODEL).toBe("edge");
    expect((bot as any).context.config.FAIR_VALUE_MIN_EDGE_TICKS).toBe(3);
    expect((bot as any).context.config.WIPE_LEVELS).toBe(4);
    expect((bot as any).context.config.SLIP_BUFFER).toBe(0.2);
    expect((bot as any).context.config.MAX_AGGRESS_QTY).toBe(400_000_000);
    expect((bot as any).context.config.MEANREV_K).toBe(3);
    expect((bot as any).context.config.INV_SKEW_STRENGTH).toBe(0.5);
    expect((bot as any).context.config.EXTREME_PUSH_PROB).toBe(0.15);
    expect((bot as any).context.config.BASE_RESERVE_MIN).toBe(123_456);
  });

  it("clamps constructor fair-value weights to the supported range", () => {
    expect((createBot(-0.5) as any).context.config.FAIR_VALUE_WEIGHT).toBe(0);
    expect((createBot(1.5) as any).context.config.FAIR_VALUE_WEIGHT).toBe(1);
  });

  it("uses the wallet supplied by the host application", () => {
    const wallet = Wallet.createRandom() as unknown as Wallet;
    const bot = new TradingBot({
      wallet,
      apiUrl: "https://example.com/api",
      assetId: "1",
      chainId: 1,
      contracts: {
        exchange: "0x1111111111111111111111111111111111111111",
        ledger: "0x2222222222222222222222222222222222222222",
        settlementToken: "0x3333333333333333333333333333333333333333",
      },
    });

    expect((bot as any).wallet).toBe(wallet);
  });
});
