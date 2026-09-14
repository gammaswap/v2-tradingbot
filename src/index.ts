/**
 * Public API for @gammaswap/v2-tradingbot.
 *
 * Runtime, API, order-planning, and environment-loader internals are not part
 * of this semver-supported package boundary.
 */
export {
  TradingBot,
  validateTradingBotOptions,
  type ContractAddresses,
  type TradingBotOptions,
  type TradingBotStatus,
} from "./runtime/tradingBot.js";
export type { AggressionModel, Side } from "./config/config.js";
export type { LogLevel } from "./utils/logger.js";
