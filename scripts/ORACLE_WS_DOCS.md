# Oracle WebSocket API

The oracle WebSocket publishes price updates for subscribed `symbolId` values. This document describes the direct WebSocket protocol for clients that send and receive raw JSON messages.

Default local base URL:

```text
ws://127.0.0.1:8082
```

Production base URL:

```text
wss://exchange-api.gammaswap.com/oracle-ws/
```

## Local Direct Client

This repository includes a direct oracle WebSocket client script at `scripts/api/wsOracleTest.ts`.

Run it from the repository root:

```bash
SYMBOL_ID=1 ORACLE_FEED_WS_URL=ws://127.0.0.1:8082 pnpm api:ws:oracle
```

Environment variables:

| Variable              | Default               | Description                                                    |
| --------------------- | --------------------- | -------------------------------------------------------------- |
| `SYMBOL_ID`           | `1`                   | Symbol id to subscribe to.                                     |
| `ORACLE_FEED_WS_URL`  | `ws://127.0.0.1:8082` | Full oracle WebSocket URL when `ORACLE_FEED_WS_PORT` is unset. |
| `ORACLE_FEED_WS_PORT` | `8082`                | Local port used to build the default `ORACLE_FEED_WS_URL`.     |

The script opens `ORACLE_FEED_WS_URL`, sends this subscription after the socket opens, prints every received message, logs protocol ping frames, and logs socket errors or close events:

```json
{
  "type": "subscribe",
  "symbolId": "1"
}
```

## Connection Flow

1. Open a WebSocket connection.
2. Wait for the `connected` control message.
3. Send a `subscribe` message for at least one `symbolId`.
4. Read `subscribed`, `error`, and price update messages.
5. Optionally send more `subscribe` or `unsubscribe` messages on the same socket.

## Client Messages

### Subscribe

Subscribe to price updates for one symbol:

```json
{
  "type": "subscribe",
  "symbolId": "1"
}
```

### Unsubscribe

Stop receiving price updates for one symbol:

```json
{
  "type": "unsubscribe",
  "symbolId": "1"
}
```

## Control Messages

### Connected

Sent after the socket opens:

```json
{
  "type": "connected",
  "message": "Send {\"type\":\"subscribe\",\"symbolId\":\"...\"} to receive prices"
}
```

### Subscribed

Sent after a successful subscription:

```json
{
  "type": "subscribed",
  "symbolId": "1"
}
```

### Unsubscribed

Sent after a successful unsubscribe:

```json
{
  "type": "unsubscribed",
  "symbolId": "1"
}
```

If a symbol later becomes unavailable, the server can also send an unsubscribe notification with a reason:

```json
{
  "type": "unsubscribed",
  "symbolId": "1",
  "reason": "symbol unavailable"
}
```

### Error

Sent when a client message cannot be handled:

```json
{
  "type": "error",
  "message": "SymbolId 123 is not available"
}
```

## Price Updates

Price update messages include `type`, `symbolId`, `price`, and `ts` fields.

```json
{
  "type": "price",
  "symbolId": "1",
  "price": "123456789",
  "ts": 1730000000
}
```

## Heartbeat

The server sends WebSocket protocol-level ping frames. Standard browser WebSocket implementations and the Node `ws` client automatically respond with protocol pong frames.

Clients do not need to send application-level `{ "type": "pong" }` messages.

## Browser Example

```js
const ws = new WebSocket("ws://127.0.0.1:8082");

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", symbolId: "1" }));
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "price") {
    console.log("price update", message.symbolId, message.price, message.ts);
  }
});

ws.addEventListener("close", (event) => {
  console.log("closed", event.code, event.reason);
});
```

## Node `ws` Example

This is the same direct protocol used by `scripts/api/wsOracleTest.ts`:

```js
import WebSocket from "ws";

const symbolId = process.env.SYMBOL_ID || "1";
const websocketUrl = process.env.ORACLE_FEED_WS_URL || "ws://127.0.0.1:8082";
const ws = new WebSocket(websocketUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", symbolId }));
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
```
