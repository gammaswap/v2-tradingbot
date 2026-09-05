# WebSocket API

The market WebSocket publishes order, trade, cancel, and resolution updates for subscribed `assetId` values. 
This document describes the direct WebSocket protocol for clients that send and receive raw JSON messages.

Default local base URL:

```text
ws://127.0.0.1:4000
```

Production base URL:

```text
wss://exchange-api.gammaswap.com/ws/
```

## Local Direct Client

This repository includes a direct WebSocket client script at `scripts/api/wsBookTest.ts`.

Run it from the repository root:

```bash
ASSET_ID=1 WS_SERVICE_URL=ws://127.0.0.1:4000 pnpm api:ws:book
```

Environment variables:

| Variable          | Default                                               | Description                                                 |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `ASSET_ID`        | `261336857817713630688382311349658711122006440411137` | Asset id to subscribe to.                                   |
| `WS_SERVICE_URL`  | `ws://127.0.0.1:4000`                                 | Full WebSocket service URL when `WS_SERVICE_PORT` is unset. |
| `WS_SERVICE_PORT` | `4000`                                                | Local port used to build the default `WS_SERVICE_URL`.      |

The script opens `WS_SERVICE_URL`, sends this subscription after the socket opens, prints every received message, logs protocol ping frames, and logs socket errors or close events:

```json
{
  "type": "subscribe",
  "assetId": "1"
}
```

## Connection Flow

1. Open a WebSocket connection.
2. Wait for the `connected` control message.
3. Send a `subscribe` message for at least one `assetId`.
4. Read `subscribed`, `error`, and market update messages.
5. Optionally send more `subscribe` or `unsubscribe` messages on the same socket.

## Client Messages

### Subscribe

Subscribe to market updates for one asset:

```json
{
  "type": "subscribe",
  "assetId": "1"
}
```

### Unsubscribe

Stop receiving market updates for one asset:

```json
{
  "type": "unsubscribe",
  "assetId": "1"
}
```

## Control Messages

### Connected

Sent after the socket opens:

```json
{
  "type": "connected",
  "message": "Send {\"type\":\"subscribe\",\"assetId\":\"...\"} to receive market updates"
}
```

### Subscribed

Sent after a successful subscription:

```json
{
  "type": "subscribed",
  "assetId": "1"
}
```

### Unsubscribed

Sent after a successful unsubscribe:

```json
{
  "type": "unsubscribed",
  "assetId": "1"
}
```

### Error

Sent when a client message cannot be handled:

```json
{
  "type": "error",
  "message": "AssetId 123 is not available"
}
```

## Market Updates

Market update messages include a `type`, `seqId`, and event-specific `data` object. The `data` object is the event payload published by the exchange relayer.

### Order

```json
{
  "type": "order",
  "seqId": 123,
  "data": {}
}
```

### Trade

```json
{
  "type": "trade",
  "seqId": 124,
  "data": {}
}
```

### Cancel

```json
{
  "type": "cancel",
  "seqId": 125,
  "data": {}
}
```

### Resolution

```json
{
  "type": "resolution",
  "seqId": 126,
  "data": {}
}
```

## Heartbeat

The server sends WebSocket protocol-level ping frames. Standard browser WebSocket implementations and the Node `ws` client automatically respond with protocol pong frames.

Clients do not need to send application-level `{ "type": "pong" }` messages.

## Browser Example

```js
const ws = new WebSocket("ws://127.0.0.1:4000");

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", assetId: "1" }));
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log(message);
});

ws.addEventListener("close", (event) => {
  console.log("closed", event.code, event.reason);
});
```

## Node `ws` Example

This is the same direct protocol used by `scripts/api/wsBookTest.ts`:

```js
import WebSocket from "ws";

const assetId = process.env.ASSET_ID || "1";
const websocketUrl = process.env.WS_SERVICE_URL || "ws://127.0.0.1:4000";
const ws = new WebSocket(websocketUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", assetId }));
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
