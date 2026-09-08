import "dotenv/config";
import { createOracleWebSocketClient } from "@gammaswap/v2-exchange-sdk";

const SYMBOL_ID = process.env.SYMBOL_ID || "1";
const ORACLE_FEED_WS_URL =
  process.env.ORACLE_FEED_WS_URL ?? `ws://127.0.0.1:${process.env.ORACLE_FEED_WS_PORT ?? "8082"}`;

// run with something like:
// pnpm sample:ws:oracle
// or pnpm sample:ws:oracle <symbolId>
async function main() {
  const args = process.argv.slice(2);
  const symbolId = args[0] || SYMBOL_ID;

  console.log("ORACLE_FEED_WS_URL:", ORACLE_FEED_WS_URL);
  console.log("SYMBOL_ID:", SYMBOL_ID);
  const client = createOracleWebSocketClient({
    websocketUrl: ORACLE_FEED_WS_URL,
    onError: (error) => {
      console.error("Oracle WebSocket error:", error);
    },
  });

  await client.subscribePrice(symbolId, {
    onPrice: (update) => {
      console.log("Oracle price update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onStale: (staleSymbolId) => {
      console.log("Oracle stream is stale for symbolId:", staleSymbolId);
    },
    onError: (error) => {
      console.error("Oracle subscription error:", error);
    },
  });

  console.log(`connected to ${ORACLE_FEED_WS_URL}`);
  console.log(`subscribed to symbolId ${symbolId}`);

  process.once("SIGINT", () => {
    client.close();
    process.exit(0);
  });
}

function stringifyBigInt(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
