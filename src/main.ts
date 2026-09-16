import { TradingBot } from "./index.js";
import { createBotOptionsFromEnvironment } from "./app/createBotOptionsFromEnv.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("main");

/**
 * Repository standalone entry point. Applications embedding this package
 * should import TradingBot from the package root and provide their own options.
 */
async function main(): Promise<void> {
  const options = createBotOptionsFromEnvironment();
  const bot = new TradingBot(options);

  logger.info("starting trading bot", { assetId: options.assetId });
  await bot.start();

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("received", signal, "stopping trading bot");
    void bot.stop().finally(() => process.exit(0));
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("fatal:", error);
  process.exit(1);
});
