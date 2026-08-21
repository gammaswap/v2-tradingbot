# @gammaswap/v2-exchange-sdk

TypeScript SDK for the GammaSwap v2 exchange.

## Requirements

- Node.js 20+
- pnpm 10+ for local development

## Install

```sh
npm install @gammaswap/v2-exchange-sdk
```

## Imports

```ts
import {
    createInfoClient,
    createExchangeClient,
    createDepositClient,
    createExchangeWebSocketClient,
    createOracleWebSocketClient,
} from "@gammaswap/v2-exchange-sdk";
```

Submodules are also exported:

```ts
import { createExchangeWebSocketClient } from "@gammaswap/v2-exchange-sdk/websocket";
import { createOracleWebSocketClient } from "@gammaswap/v2-exchange-sdk/oracle-websocket";
import { parseUnsignedInteger } from "@gammaswap/v2-exchange-sdk/integer-inputs";
import { parseAddress } from "@gammaswap/v2-exchange-sdk/string-inputs";
import { TimeInForce } from "@gammaswap/v2-exchange-sdk/constants";
import { decodeAssetId } from "@gammaswap/v2-exchange-sdk/assetIdUtils";
```

## Asset ID utilities

An exchange `assetId` is a packed `uint256`. It contains the base asset ID,
market type, start time, epoch period length, strike, range, and reserved bits.
The utilities in `assetIdUtils` encode and decode this representation without
floating-point arithmetic. The 64-bit base asset ID and other protocol-sized
values are represented as `bigint` or decimal strings.

### Encode and decode an asset ID

Use `encodeAssetId()` when constructing an asset ID from its packed fields, and
`decodeAssetId()` when you need to inspect an existing asset ID:

```ts
import { decodeAssetId, encodeAssetId } from "@gammaswap/v2-exchange-sdk";

const assetId = encodeAssetId(
  "12345678901234567890", // uint64 base asset ID
  1, // market type
  1_700_000_000, // start time in Unix seconds
  900, // epoch period: 15 minutes
  "50000000", // strike
  0, // range
);

const decoded = decodeAssetId(assetId);
console.log(decoded.id); // "12345678901234567890"
console.log(decoded.periodLength); // 900
console.log(decoded.expiration); // startTime + periodLength
```

`decodeAssetId()` returns the 64-bit `id` as a decimal string, preserving the
full value without JavaScript number precision loss. The `strike` and
`reserved` fields are also returned as decimal strings. The function returns
`expiration` as a convenience value; expiration is not stored as a separate
packed field.

### Convert epoch periods to timeframes

`getExpirationTf()` formats a duration in seconds, while `parseExpirationTf()`
converts a timeframe back to seconds:

```ts
import { getExpirationTf, parseExpirationTf } from "@gammaswap/v2-exchange-sdk";

getExpirationTf(900); // "15m"
parseExpirationTf("15m"); // 900
parseExpirationTf("1h"); // 3600
```

Supported units are seconds (`s`), minutes (`m`), hours (`h`), days (`d`),
weeks (`w`), months (`M`), and years (`y`). Timeframe values must be positive
whole numbers.

## Input Units

Protocol values are validated before requests are sent. Prices, sizes, amounts,
nonces, IDs, and balances are converted to `bigint` internally and serialized as
decimal strings at JSON boundaries.

Order and transfer inputs use human decimal strings:

- `size` and `amount` allow up to two decimal places.
- `price` allows one decimal place and is interpreted as cents. For example,
  `99.9` becomes `999000n` in protocol units.
- Invalid precision, zero amounts, out-of-range values, invalid nonces, and
  invalid hashes throw validation errors before the SDK sends a request.

Integer-only helpers are exported from `@gammaswap/v2-exchange-sdk/integer-inputs`
for canonical unsigned decimal strings and bigint values. They intentionally
reject JavaScript numbers unless a helper is explicitly for safe JSON/runtime
integers.

String-shaped helpers are exported from `@gammaswap/v2-exchange-sdk/string-inputs`
for EVM addresses, non-zero addresses, hex data, bytes32 values, and
case-insensitive address comparison.

### Request input conventions

- `ProtocolBigNumberish`: `bigint` or canonical decimal string.
- `HumanDecimalString`: human decimal string such as `"10"`, `"10.25"`, or
  `"99.9"`.
- `Address`: EVM address string.
- `HexString`: hex string. Order IDs and hashes are represented as `bytes32`
  hex strings.
- Optional `nonce` fields are filled by the configured `NonceManager` when
  omitted.

### Nonce generation

`NonceManager` generates unsigned 64-bit nonces as `bigint` values. The nonce is
laid out as:

```text
[ 48-bit timestamp in milliseconds ][ 16-bit counter ]
```

`nonceManager.next()` reads `Date.now()` by default. When the physical clock has
advanced since the previous generated nonce, the timestamp portion is updated and
the counter resets to `0`. If another nonce is requested in the same millisecond,
or if the system clock moves backward, the manager keeps the previous logical
timestamp and increments the 16-bit counter.

The counter range is `0` through `65,535`, so at most `65,536` nonces can share
the same logical millisecond. If more nonces are requested before the physical
clock advances, the SDK does not throw or block; it advances its logical
timestamp by one millisecond and resets the counter. It continues generating
monotonically increasing nonces, but the timestamp portion can move ahead of
wall-clock time under extremely high throughput or a backward-moving system
clock.

This is a per-millisecond counter limit, not a limit on the number of signed
messages or open orders. The SDK does not track whether generated nonces are
pending, accepted, rejected, or already submitted; it only generates the next
value in the local sequence.

The uniqueness guarantee is local to one `NonceManager` instance. It does not
coordinate across browser tabs, Node processes, servers, devices, or separate
SDK clients using the same account. If multiple writers sign actions for the
same account, share a nonce allocator, reuse one `NonceManager`, or pass explicit
nonces from your own coordinated source.

## InfoClient

`InfoClient` is the read-only HTTP client for exchange API data.

```ts
const info = createInfoClient({
  apiUrl: "https://exchange-api.gammaswap.com",
});
```

### Constructor parameters:

- `apiUrl`: required base URL for the exchange API.
- `fetch`: optional replacement for `globalThis.fetch`, useful in tests or
  custom runtimes.
- `headers`: optional headers added to every request.
- `timeoutMs`: optional default timeout for HTTP requests. Defaults to 30,000
  ms; individual calls can override it.

Every HTTP method accepts an optional second `HttpRequestOptions` argument:

```ts
const controller = new AbortController();
const balance = await info.getBalance(account, {
  timeoutMs: 10_000,
  signal: controller.signal,
});
```

Use `signal` to cancel a request from the caller. Timeouts throw
`HttpTimeoutError`; caller cancellation throws `HttpAbortError`. The same
request options are supported by `ExchangeClient` action methods.

### Available functions:

- `getHealth()`
- `getAsset(inputOrAssetId)`
- `getAssetAtEpoch(input)`
- `getResolutionPrice(input)`
- `getLastResolutionPrice(inputOrAssetId)`
- `getBalance(inputOrAccount)`
- `getOrderBook(input)`
- `getBookOrders(input)`
- `getTopOfBook(input)`
- `getPosition(input)`
- `getClaimable(input)`
- `getMarkPrice(inputOrAssetId)`
- `getSettlementPrice(input)`
- `getAgentApproval(inputOrAccount)`
- `getAgentApprovalNonce(inputOrAccount)`
- `getExchangeConfig(inputOrChainId)`

### GET request inputs:

| Function                                 | Route                                     | Input fields                                                                      |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `getHealth()`                            | `GET /health`                             | No input.                                                                         |
| `getAsset(inputOrAssetId)`               | `GET /asset/:assetId`                     | `assetId`: market asset id. Accepts `{ assetId }` or the asset id directly.       |
| `getAssetAtEpoch(input)`                 | `GET /asset/:assetId/:epoch`              | `assetId`: market asset id. `epoch`: requested market epoch.                      |
| `getResolutionPrice(input)`              | `GET /resolve/:assetId/:epoch`            | `assetId`: market asset id. `epoch`: market epoch.                                |
| `getLastResolutionPrice(inputOrAssetId)` | `GET /resolve/last/epoch/:assetId`        | `assetId`: market asset id. Accepts `{ assetId }` or the asset id directly.       |
| `getBalance(inputOrAccount)`             | `GET /balance/:account`                   | `account`: account address. Accepts `{ account }` or the address directly.        |
| `getOrderBook(input)`                    | `GET /book/:assetId/:epoch`               | `assetId`: market asset id. `epoch`: market epoch.                                |
| `getBookOrders(input)`                   | `GET /book/:assetId/:epoch/:account`      | `assetId`: market asset id. `epoch`: market epoch. `account`: account address.    |
| `getTopOfBook(input)`                    | `GET /book/market/top/:assetId/:epoch`    | `assetId`: market asset id. `epoch`: market epoch.                                |
| `getPosition(input)`                     | `GET /position/:account/:assetId/:epoch`  | `account`: account address. `assetId`: market asset id. `epoch`: market epoch.    |
| `getClaimable(input)`                    | `GET /claim/:assetId/:epoch/:account`     | `account`: account address. `assetId`: market asset id. `epoch`: market epoch.    |
| `getMarkPrice(inputOrAssetId)`           | `GET /resolve/mark/:assetId`              | `assetId`: market asset id. Accepts `{ assetId }` or the asset id directly.       |
| `getSettlementPrice(input)`              | `GET /resolve/settlement/:assetId/:epoch` | `assetId`: market asset id. `epoch`: market epoch.                                |
| `getAgentApproval(inputOrAccount)`       | `GET /agents/status/:master`              | `account`: master account address. Accepts `{ account }` or the address directly. |
| `getAgentApprovalNonce(inputOrAccount)`  | `GET /agents/status/:master`              | Same input as `getAgentApproval`; returns only the parsed approval nonce.         |
| `getExchangeConfig(inputOrChainId)`      | `GET /config/chains/:chainId`             | `chainId`: exchange chain id. Accepts `{ chainId }` or the chain id directly.     |

### Notes:

- This client does not sign messages and does not need a wallet.
- Successful informational responses are validated against the API response
  schemas. Protocol numeric fields are returned as `bigint`; timestamps and
  sequence IDs are also converted to `bigint` to avoid precision loss.
- HTTP errors remain `HttpResponseError` instances and preserve the API's raw
  error payload in `error.data`.
- Network and other fetch-level failures are normalized to
  `HttpTransportError`; the original error is available as `error.cause` and
  the requested URL as `error.url`.
- `apiUrl` is normalized with a trailing slash internally.
- `getExchangeConfig()` fetches configured contract addresses from the API, but
  the SDK also has hard-coded defaults for supported chain IDs.
- `getAsset(inputOrAssetId)` reads the current asset state from the latest
  exchange epoch, including its current strike price, resolution price,
  resolution status, and expiration.
- `getAssetAtEpoch({ assetId, epoch })` reads the state for the explicitly
  requested epoch, including that epoch's strike price, resolution price, and
  expiration.
- `getResolutionPrice({ assetId, epoch })` fetches the resolution price for a
  specific asset and epoch from `/resolve/:assetId/:epoch`. It remains available
  for compatibility and for consumers that need the standalone resolution
  response. It requires an input object because it has two fields.
- `getLastResolutionPrice(inputOrAssetId)` fetches the latest resolution price
  for an asset from `/resolve/last/epoch/:assetId`. Like other single-field
  read calls, it accepts either `{ assetId }` or the asset ID directly.

## ExchangeClient

`ExchangeClient` signs exchange actions with an `ethers` wallet and posts the
signed payloads to the exchange API.

```ts
import { Wallet } from "ethers";

const exchange = createExchangeClient({
  apiUrl: "https://exchange-api.gammaswap.com",
  wallet: new Wallet(process.env.PRIVATE_KEY!),
  chainId: "84532",
});
```

### Constructor parameters:

- `apiUrl`: required base URL for the exchange API.
- `wallet`: required `ethers` `Wallet` used for signing.
- `chainId`: required chain ID. If default contracts exist for this chain, the
  SDK uses them automatically.
- `contracts`: optional contract address overrides. Provide this when the chain
  has no SDK default or when testing custom deployments.
- `fetch`: optional replacement for `globalThis.fetch`.
- `headers`: optional headers added to every HTTP request.
- `timeoutMs`: optional default timeout for HTTP requests. Defaults to 30,000
  ms; individual calls can override it.
- `infoClient`: optional `InfoClient` instance. If omitted, the exchange client
  creates one using the same `apiUrl`, `fetch`, and `headers`.
- `nonceManager`: optional `NonceManager`. If omitted, a local nonce manager is
  used to fill missing action nonces.

### Available functions:

- `placeOrder(input)`
- `placeAgentOrder(input)`
- `cancelOrder(input)`
- `cancelAll(input)`
- `cancelReplaceOrder(input)`
- `cancelAgentOrder(input)`
- `cancelAllAgent(input)`
- `cancelReplaceAgentOrder(input)`
- `claim(input)`
- `claimAgent(input)`
- `withdraw(input)`
- `approveAgent(input)`
- `revokeAgent(input)`
- `signAgentApproval(input)`

### Signed POST request inputs:

These functions sign and submit an API request. The SDK fills `signer`,
`signatureType`, `chainId`, `orderHash`, and `signature` from the configured
wallet, chain, contracts, and input fields. For EOA requests, the SDK also uses
the configured wallet address as `sender`.

| Function                         | Route                  | Input fields                                                                                                                                                    |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placeOrder(input)`              | `POST /orders`         | `assetId`, `epoch`, `side`, `price`, `size`, optional `timeInForce`, optional `nonce`.                                                                          |
| `placeAgentOrder(input)`         | `POST /orders`         | `assetId`, `epoch`, `side`, `price`, `size`, `sender`, optional `timeInForce`, optional `nonce`, optional `approvalNonce`.                                      |
| `cancelOrder(input)`             | `POST /cancels`        | `assetId`, `epoch`, `orderHash`, optional `nonce`.                                                                                                              |
| `cancelAll(input)`               | `POST /cancels`        | `assetId`, `epoch`, optional `nonce`. Uses the zero hash internally.                                                                                            |
| `cancelReplaceOrder(input)`      | `POST /cancel-replace` | `assetId`, `epoch`, `cancelOrderHash`, `side`, `price`, `size`, optional `timeInForce`, optional `nonce`, optional `replacementNonce`, optional `allOrNothing`. |
| `cancelAgentOrder(input)`        | `POST /cancels`        | `assetId`, `epoch`, `orderHash`, `sender`, optional `nonce`, optional `approvalNonce`.                                                                          |
| `cancelAllAgent(input)`          | `POST /cancels`        | `assetId`, `epoch`, `sender`, optional `nonce`, optional `approvalNonce`. Uses the zero hash internally.                                                        |
| `cancelReplaceAgentOrder(input)` | `POST /cancel-replace` | Same input as `cancelReplaceOrder`, plus `sender` and optional `approvalNonce`.                                                                                 |
| `claim(input)`                   | `POST /claim`          | `assetId`, `epoch`, optional `nonce`.                                                                                                                           |
| `claimAgent(input)`              | `POST /claim`          | `assetId`, `epoch`, `sender`, optional `nonce`, optional `approvalNonce`.                                                                                       |
| `withdraw(input)`                | `POST /withdrawals`    | `amount`, optional `nonce`, optional `receiver`.                                                                                                                |
| `approveAgent(input)`            | `POST /agents/approve` | `agent`, optional `approvalNonce`, optional `nonce`.                                                                                                            |
| `revokeAgent(input)`             | `POST /agents/revoke`  | Optional `nonce`.                                                                                                                                               |

#### Signed POST field descriptions:

| Field              | Meaning                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `assetId`          | Market asset id.                                                                               |
| `epoch`            | Market epoch.                                                                                  |
| `side`             | `false` for buy, `true` for sell.                                                              |
| `price`            | Human decimal limit price string. One decimal place is allowed and interpreted as cents.       |
| `size`             | Human decimal order size string. Up to two decimal places.                                     |
| `amount`           | Human decimal withdrawal amount string. Up to two decimal places.                              |
| `timeInForce`      | Optional time-in-force value. Defaults to `TimeInForce.GTC`.                                   |
| `nonce`            | Optional action nonce. Defaults to `nonceManager.next()`.                                      |
| `replacementNonce` | Optional nonce for the replacement order in cancel-replace. Defaults to `nonceManager.next()`. |
| `orderHash`        | Existing order id/hash to cancel.                                                              |
| `cancelOrderHash`  | Existing non-zero order id/hash to cancel before submitting the replacement order.             |
| `allOrNothing`     | Optional cancel-replace atomicity flag. Defaults to `false`.                                   |
| `sender`           | Master account address when the configured wallet signs as an approved agent.                  |
| `approvalNonce`    | Agent approval nonce. If omitted on agent actions, the SDK fetches it from `InfoClient`.       |
| `receiver`         | Optional withdrawal receiver. Defaults to the configured wallet address.                       |
| `agent`            | Agent address being approved. Must differ from the configured wallet address.                  |

### Notes:

- Signed actions are strongly typed and reject unknown input fields at compile
  time when object literals are passed directly.
- If `nonce` is omitted, the configured `NonceManager` generates one.
- If `timeInForce` is omitted for orders, the SDK uses `TimeInForce.GTC`.
- Agent order, cancel, cancel-replace, and claim calls fetch the approval nonce
  from `InfoClient` when `approvalNonce` is omitted.
- `approveAgent()` requires the agent address to be different from the master
  wallet address and requires an approval nonce within the allowed future window.
- `cancelReplaceOrder()` and `cancelReplaceAgentOrder()` do not support the
  zero-hash cancel-all behavior.
- `chainId` is always required. `contracts` are optional only when the SDK has
  default contracts for that chain.

## DepositClient

`DepositClient` sends on-chain transactions for deposit-related settlement token
flows.

```ts
import { Wallet } from "ethers";

const deposit = createDepositClient({
  rpcUrl: `BASE_SEPOLIA_RPC_URL`,
  wallet: new Wallet(process.env.PRIVATE_KEY!),
  chainId: "84532",
});
```

### Constructor parameters:

- `rpcUrl`: required JSON-RPC URL used to send transactions.
- `wallet`: required `ethers` `Wallet`; the client connects it to the RPC
  provider.
- `chainId`: required chain ID. The RPC network must match this value.
- `depositLedger`: optional deposit ledger address override.
- `contracts`: optional contract address overrides. Used to resolve
  `depositLedger` if `depositLedger` is not provided.
- `settlementTokenDecimals`: optional, currently required to be `6`.

### Available functions:

- `getSettlementToken()`
- `getPermit2()`
- `getAccountLedger()`
- `getPendingBalance()`
- `getProcessedBalance()`
- `getPendingDepositCount()`
- `getNextPendingDepositId()`
- `getProcessedDepositIndex()`
- `getMinBlockWait()`
- `canProcessNext()`
- `getSettlementTokenBalance(owner?)`
- `getSettlementTokenAllowance(spender?, owner?)`
- `approveDepositLedger(input)`
- `approvePermit2(input)`
- `deposit(input)`
- `signDepositPermit(input)`
- `depositWithPermit(input)`
- `parseAmount(amount)`

### Notes:

- This client talks directly to the chain, not the HTTP exchange API.
- The client checks the RPC chain ID before contract reads and transactions.
- `depositLedger` can be passed explicitly or resolved from the default
  contracts for the configured chain.
- Settlement token, Permit2, and account ledger addresses are read from the
  deposit ledger contract.
- `deposit()` logs the deposit `txId` by default. Pass `logTxId: false` in the
  input to suppress that log.

## ExchangeWebSocketClient

`ExchangeWebSocketClient` subscribes to order book market-update streams by
`assetId`.

```ts
const ws = createExchangeWebSocketClient({
  websocketUrl: "wss://exchange-api.gammaswap.com",
  onError: (error) => console.error(error),
});

const unsubscribe = await ws.subscribeOrderBook("ASSET_ID", {
  onUpdate: (update) => console.log(update),
  onResyncRequired: (assetId) => {
    console.log("Reload full book from REST for", assetId);
  },
});

await unsubscribe();
ws.close();
```

### Constructor parameters:

- `websocketUrl`: required websocket endpoint URL.
- `WebSocketCtor`: optional websocket constructor. Defaults to
  `globalThis.WebSocket` when available, otherwise Node `ws`.
- `reconnect`: optional boolean, defaults to `true`.
- `reconnectDelayMs`: optional initial reconnect delay, defaults to `1000`.
- `maxReconnectDelayMs`: optional reconnect delay cap, defaults to `30000`.
- `ackTimeoutMs`: optional subscribe/unsubscribe acknowledgement timeout,
  defaults to `15000`.
- `onError`: optional global error callback.

### Available functions and properties:

- `connectionState`
- `connect()`
- `close(code?, reason?)`
- `subscribeOrderBook(assetId, handlers)`
- `unsubscribeOrderBook(assetId)`

### Subscription handlers:

- `onUpdate(update)`
- `onOrder(update)`
- `onTrade(update)`
- `onCancel(update)`
- `onResolution(update)`
- `onError(error)`
- `onResyncRequired(assetId)`

### Notes:

- One client can subscribe to multiple asset IDs.
- Subscribing multiple handlers to the same asset ID sends one server
  subscription and fans updates out locally.
- The unsubscribe function returned by `subscribeOrderBook()` removes only that
  handler. If no handlers remain for the asset, the client sends an unsubscribe
  message to the server.
- `unsubscribeOrderBook(assetId)` removes all handlers for that asset.
- If the connection drops or the SDK decides the socket is unhealthy, active
  handlers receive `onResyncRequired(assetId)`. Consumers should reload the full
  book from REST before applying future stream updates.
- Unsubscribe acknowledgement failures are best-effort. The local subscription
  is removed, the error is emitted, and the client reconnects only if other
  active subscriptions remain.
- Browser WebSocket implementations only support `close()`. Node `ws` also has
  `terminate()`. The SDK accepts an optional `terminate()` on `WebSocketLike` and
  uses it when a socket is already considered unhealthy; otherwise it falls back
  to `close()`. Events from abandoned sockets are ignored so stale close/error
  events cannot affect a newer connection.
- If an abandoned browser socket does not complete `close()` cleanly, the SDK has
  no stronger browser-safe close primitive. The server heartbeat or TCP timeout
  is the fallback that eventually reaps the old connection.

## OracleWebSocketClient

`OracleWebSocketClient` subscribes to oracle price streams by `symbolId`.

```ts
const oracle = createOracleWebSocketClient({
  websocketUrl: "wss://exchange-api.gammaswap.com",
  stalePriceTimeoutMs: 30_000,
  onError: (error) => console.error(error),
});

const unsubscribe = await oracle.subscribePrice("1", {
  onPrice: (update) => console.log(update.symbolId, update.price, update.ts),
  onStale: (symbolId) => {
    console.log("oracle stream is stale for", symbolId);
  },
});

await unsubscribe();
oracle.close();
```

### Constructor parameters:

- `websocketUrl`: required oracle websocket endpoint URL.
- `WebSocketCtor`: optional websocket constructor. Defaults to
  `globalThis.WebSocket` when available, otherwise Node `ws`.
- `reconnect`: optional boolean, defaults to `true`.
- `reconnectDelayMs`: optional initial reconnect delay, defaults to `1000`.
- `maxReconnectDelayMs`: optional reconnect delay cap, defaults to `30000`.
- `ackTimeoutMs`: optional subscribe/unsubscribe acknowledgement timeout,
  defaults to `15000`.
- `stalePriceTimeoutMs`: optional maximum time without a price update for a
  subscribed symbol, defaults to `30000`.
- `onError`: optional global error callback.

### Available functions and properties:

- `connectionState`
- `connect()`
- `close(code?, reason?)`
- `subscribePrice(symbolId, handlers)`
- `unsubscribePrice(symbolId)`

### Subscription handlers:

- `onPrice(update)`
- `onError(error)`
- `onStale(symbolId)`

### Notes:

- One client can subscribe to multiple symbol IDs.
- Subscribing multiple handlers to the same symbol ID sends one server
  subscription and fans price updates out locally.
- The unsubscribe function returned by `subscribePrice()` removes only that
  handler. If no handlers remain for the symbol, the client sends an unsubscribe
  message to the server.
- `unsubscribePrice(symbolId)` removes all handlers for that symbol.
- The oracle stream has no sequence ID and does not perform REST catch-up. If
  the socket reconnects or a stale-price timeout fires, consumers should accept
  the next live price update.
- If no price arrives for a subscribed symbol within `stalePriceTimeoutMs`, the
  client emits `onStale(symbolId)`, emits an error, abandons the socket, and
  reconnects if subscriptions remain.
- Unsubscribe acknowledgement failures are best-effort, matching the exchange
  websocket behavior.
- Failed sockets use optional Node-style `terminate()` when present and fall
  back to browser-compatible `close()`.

## Sample Scripts

Runnable examples live in `scripts/sample`. They import the SDK package, create
the relevant client, and make the API call or transaction directly in each file.

Common commands:

```sh
pnpm sample:health
pnpm sample:asset
pnpm sample:asset-at-epoch
pnpm sample:asset-id
pnpm sample:balance
pnpm sample:book
pnpm sample:book-orders
pnpm sample:book-top
pnpm sample:resolution
pnpm sample:last-resolution
pnpm sample:claimable
pnpm sample:mark-price
pnpm sample:settlement-price
pnpm sample:order
pnpm sample:cancel
pnpm sample:cancel-replace
pnpm sample:deposit
pnpm sample:withdrawal
pnpm sample:agent:approve
pnpm sample:agent:revoke
pnpm sample:agent:status
pnpm sample:agent:order
pnpm sample:agent:cancel
pnpm sample:agent:cancel-replace
pnpm sample:agent:claim
pnpm sample:ws:book
pnpm sample:ws:oracle
```

The older direct API examples live in `scripts/api`.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm validate:package
```

`pnpm validate:package` inspects the package contents with the available pack
dry-run command (`pnpm pack --dry-run`, or `npm pack --dry-run` when the
installed pnpm version does not support that option), creates the actual
publishable tarball with pnpm, installs it into a temporary consumer project,
and tests the package root and public subpath imports from that packed
artifact.

### Release validation

CI runs the build, tests, typecheck, lint, formatting check, and packed-package
validation. The packed-package check installs the generated tarball into a
temporary consumer project and verifies the package root and public subpath
imports before publishing.
