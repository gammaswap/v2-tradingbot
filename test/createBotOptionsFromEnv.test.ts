import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/runtime/wallet.js", () => ({
  resolveTradingWallet: () => ({ address: "0x4444444444444444444444444444444444444444" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PRODUCTION_MODE", "false");
  vi.stubEnv("API_URL", "https://example.com/api");
  vi.stubEnv("CHAIN_ID", "1");
  vi.stubEnv("ASSET_ID", "1");
  vi.stubEnv("EXCHANGE_ADDRESS", "0x1111111111111111111111111111111111111111");
  vi.stubEnv("LEDGER_ADDRESS", "0x2222222222222222222222222222222222222222");
  vi.stubEnv("SETTLEMENT_TOKEN", "0x3333333333333333333333333333333333333333");
  vi.stubEnv("ORACLE_NOTIFY_MIN_CHANGE_TICKS", undefined);
  vi.stubEnv("ORACLE_NOTIFY_INTERVAL_MS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("oracle notification environment forwarding", () => {
  it.each([
    [undefined, undefined, 2, 500],
    ["4", "1250", 4, 1_250],
  ] as const)(
    "forwards threshold %s and interval %s into the bot",
    async (ticks, interval, expectedTicks, expectedInterval) => {
      vi.stubEnv("ORACLE_NOTIFY_MIN_CHANGE_TICKS", ticks);
      vi.stubEnv("ORACLE_NOTIFY_INTERVAL_MS", interval);

      const { createBotOptionsFromEnvironment } =
        await import("../src/app/createBotOptionsFromEnv.js");
      const { TradingBot } = await import("../src/runtime/tradingBot.js");
      const options = createBotOptionsFromEnvironment();
      const bot = new TradingBot(options);

      expect(options.fairValue?.notifyMinChangeTicks).toBe(expectedTicks);
      expect(options.fairValue?.notifyIntervalMs).toBe(expectedInterval);
      expect((bot as any).context.config.ORACLE_NOTIFY_MIN_CHANGE_TICKS).toBe(expectedTicks);
      expect((bot as any).context.config.ORACLE_NOTIFY_INTERVAL_MS).toBe(expectedInterval);
    },
  );

  it("rejects an invalid environment setting before creating options", async () => {
    vi.stubEnv("ORACLE_NOTIFY_INTERVAL_MS", "0");
    const { createBotOptionsFromEnvironment } =
      await import("../src/app/createBotOptionsFromEnv.js");

    expect(() => createBotOptionsFromEnvironment()).toThrow("ORACLE_NOTIFY_INTERVAL_MS");
  });
});
