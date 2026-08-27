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
            fairValue: {
                oracleFeedWsUrl: "wss://example.com/oracle",
                enabled: true,
                requireFreshValue: true,
                stalePriceTimeoutMs: 23_456,
                firstPriceTimeoutMs: 34_567,
                volatility: 0.9,
                weight: 0.8,
                paysAboveStrike: false,
            },
            aggression: {
                fairValueMinEdgeTicks: 3,
            },
        });

        expect(bot).toBeInstanceOf(TradingBot);
        expect((bot as any).context.config.API_KEY).toBe("constructor-api-key");
        expect((bot as any).context.config.API_SECRET).toBe("constructor-api-secret");
        expect((bot as any).context.config.API_TIMEOUT_MS).toBe(12_345);
        expect((bot as any).context.config.ORACLE_STALE_PRICE_TIMEOUT_MS).toBe(23_456);
        expect((bot as any).context.config.ORACLE_FEED_WS_URL).toBe("wss://example.com/oracle");
        expect((bot as any).context.config.FAIR_VALUE_VOL).toBe(0.9);
        expect((bot as any).context.config.FAIR_VALUE_WEIGHT).toBe(0.8);
        expect((bot as any).context.config.FAIR_VALUE_PAYS_ABOVE_STRIKE).toBe(false);
        expect((bot as any).context.config.FAIR_VALUE_MIN_EDGE_TICKS).toBe(3);
    });
});
