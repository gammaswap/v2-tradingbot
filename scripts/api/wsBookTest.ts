import "dotenv/config";

import WebSocket from "ws";

const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const WS_SERVICE_URL =
  process.env.WS_SERVICE_URL ?? `ws://127.0.0.1:${process.env.WS_SERVICE_PORT ?? "4000"}`;

const ws = new WebSocket(WS_SERVICE_URL);

ws.on("open", () => {
  console.log(`connected to ${WS_SERVICE_URL}`);
  ws.send(JSON.stringify({ type: "subscribe", assetId: ASSET_ID }));
});

ws.on("message", (message) => {
  console.log(message.toString());
});

ws.on("ping", () => {
  console.log("ping received");
});

ws.on("error", (error) => {
  console.error(error);
});

ws.on("close", () => {
  console.log("connection closed");
});
