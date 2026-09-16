import { Wallet } from "ethers";
import {
  TradingBot,
  validateTradingBotOptions,
  type TradingBotOptions,
} from "@gammaswap/v2-tradingbot";

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) throw new Error("PRIVATE_KEY is required");

const options: TradingBotOptions = {
  wallet: new Wallet(privateKey),
  isTaker: false,
  apiUrl: "https://exchange-api.gammaswap.com/api",
  assetId: "replace-with-asset-id",
  chainId: 84532,
  contracts: {
    exchange: "0x0000000000000000000000000000000000000001",
    ledger: "0x0000000000000000000000000000000000000002",
    settlementToken: "0x0000000000000000000000000000000000000003",
  },
};

const errors = validateTradingBotOptions(options);
if (errors.length > 0) throw new Error(errors.join("; "));

const bot = new TradingBot(options);
await bot.start();

async function shutdown() {
  await bot.stop();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
