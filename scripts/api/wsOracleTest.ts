import "dotenv/config";

import WebSocket from "ws";

const SYMBOL_ID = process.env.SYMBOL_ID || "1";
const ORACLE_FEED_WS_URL =
  process.env.ORACLE_FEED_WS_URL ??
  `ws://127.0.0.1:${process.env.ORACLE_FEED_WS_PORT ?? "8082"}`;

const ws = new WebSocket(ORACLE_FEED_WS_URL);

ws.on("open", () => {
  console.log(`connected to ${ORACLE_FEED_WS_URL}`);
  ws.send(JSON.stringify({ type: "subscribe", symbolId: SYMBOL_ID }));
});

ws.on("ping", () => {
    console.log("ping received");
})

ws.on("message", (message) => {
  console.log(message.toString());
});

ws.on("error", (error) => {
  console.error(error);
});

ws.on("close", () => {
  console.log("connection closed");
});
