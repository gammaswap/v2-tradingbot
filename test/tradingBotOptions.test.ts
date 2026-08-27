import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { TradingBot } from "../src/runtime/tradingBot.js";

describe("TradingBot options", () => {
    it("accepts an oracle stale-price timeout override", () => {
        const bot = new TradingBot({
            wallet: Wallet.createRandom() as unknown as Wallet,
            apiUrl: "https://example.com/api",
            assetId: "1",
            chainId: 1,
            contracts: {
                exchange: "0x1111111111111111111111111111111111111111",
                ledger: "0x2222222222222222222222222222222222222222",
                settlementToken: "0x3333333333333333333333333333333333333333",
            },
            oracle: {
                stalePriceTimeoutMs: 12_345,
            },
        });

        expect(bot).toBeInstanceOf(TradingBot);
        expect((bot as any).context.config.ORACLE_STALE_PRICE_TIMEOUT_MS).toBe(12_345);
    });
});
