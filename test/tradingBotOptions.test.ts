import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { TradingBot } from "../src/runtime/tradingBot.js";

describe("TradingBot options", () => {
    it("accepts an oracle stale-price timeout override", () => {
        const bot = new TradingBot({
            wallet: Wallet.createRandom() as unknown as Wallet,
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
            tickSize: 1_000,
            lotSize: 10_000,
            fairValue: {
                oracleFeedWsUrl: "wss://example.com/oracle",
                enabled: true,
                requireFreshValue: true,
                stalePriceTimeoutMs: 23_456,
                firstPriceTimeoutMs: 34_567,
                fairValueStaleMs: 45_678,
                volatility: 0.9,
                weight: 0.8,
                paysAboveStrike: false,
            },
            quote: {
                quoteLoopMs: 5_000,
                quoteJitterMs: 250,
                riskAversionGamma0: 2e-9,
                riskAversionGammaMax: 2e-8,
                riskAversionB: 4,
                totalSizeDecayK: 2.5,
                totalSizeDecayA: 0.75,
                totalSizeTimeBucketSeconds: 10,
            },
            aggression: {
                aggressionMs: 6_000,
                aggressionJitterMs: 300,
                fairValueMinEdgeTicks: 3,
            },
            risk: {
                baseReserveMin: 123_456,
            },
        });

        expect(bot).toBeInstanceOf(TradingBot);
        expect((bot as any).context.config.API_KEY).toBe("constructor-api-key");
        expect((bot as any).context.config.API_SECRET).toBe("constructor-api-secret");
        expect((bot as any).context.config.API_TIMEOUT_MS).toBe(12_345);
        expect((bot as any).context.config.ORDERBOOK_WS_URL).toBe("wss://example.com/orderbook");
        expect((bot as any).context.config.BOOK_STALE_MS).toBe(11_111);
        expect((bot as any).context.config.TICK_SIZE).toBe(1_000);
        expect((bot as any).context.config.LOT_SIZE).toBe(10_000);
        expect((bot as any).context.config.ORACLE_STALE_PRICE_TIMEOUT_MS).toBe(23_456);
        expect((bot as any).context.config.FAIR_VALUE_STALE_MS).toBe(45_678);
        expect((bot as any).context.config.ORACLE_FEED_WS_URL).toBe("wss://example.com/oracle");
        expect((bot as any).context.config.FAIR_VALUE_VOL).toBe(0.9);
        expect((bot as any).context.config.FAIR_VALUE_WEIGHT).toBe(0.8);
        expect((bot as any).context.config.FAIR_VALUE_PAYS_ABOVE_STRIKE).toBe(false);
        expect((bot as any).context.config.QUOTE_LOOP_MS).toBe(5_000);
        expect((bot as any).context.config.QUOTE_JITTER_MS).toBe(250);
        expect((bot as any).context.config.RISK_AVERSION_GAMMA_0).toBe(2e-9);
        expect((bot as any).context.config.RISK_AVERSION_GAMMA_MAX).toBe(2e-8);
        expect((bot as any).context.config.RISK_AVERSION_B).toBe(4);
        expect((bot as any).context.config.TOTAL_SIZE_DECAY_K).toBe(2.5);
        expect((bot as any).context.config.TOTAL_SIZE_DECAY_A).toBe(0.75);
        expect((bot as any).context.config.TOTAL_SIZE_TIME_BUCKET_SECONDS).toBe(10);
        expect((bot as any).context.config.AGGRESS_MS).toBe(6_000);
        expect((bot as any).context.config.AGGRESS_JITTER_MS).toBe(300);
        expect((bot as any).context.config.FAIR_VALUE_MIN_EDGE_TICKS).toBe(3);
        expect((bot as any).context.config.BASE_RESERVE_MIN).toBe(123_456);
    });
});
