import "dotenv/config";
import { createExchangeWebSocketClient } from "@gammaswap/v2-exchange-sdk";

const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";

const WS_SERVICE_URL =
  process.env.WS_SERVICE_URL ?? `ws://127.0.0.1:${process.env.WS_SERVICE_PORT ?? "4000"}`;

// run with "pnpm sample:ws:book"
// or "pnpm sample:ws:book <assetId>"
async function main() {
  const args = process.argv.slice(2);
  const assetId = args[0] || ASSET_ID;

  console.log("WS_SERVICE_URL:", WS_SERVICE_URL);
  console.log("ASSET_ID:", ASSET_ID);
  const client = createExchangeWebSocketClient({
    websocketUrl: WS_SERVICE_URL,
    onError: (error) => {
      console.error("WebSocket error:", error);
    },
  });

  await client.subscribeOrderBook(assetId, {
    onUpdate: (update) => {
      console.log("Market update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onOrder: (update) => {
      console.log("Order update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onTrade: (update) => {
      console.log("Trade update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onCancel: (update) => {
      console.log("Cancel update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onResolution: (update) => {
      console.log("Resolution update:", JSON.stringify(update, stringifyBigInt, 2));
    },
    onResyncRequired: (resyncAssetId) => {
      console.log("Resync required for assetId:", resyncAssetId);
    },
    onError: (error) => {
      console.error("Subscription error:", error);
    },
  });

  console.log(`connected to ${WS_SERVICE_URL}`);
  console.log(`subscribed to assetId ${assetId}`);

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
