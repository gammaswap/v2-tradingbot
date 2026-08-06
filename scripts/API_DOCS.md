# Exchange API Reference

This document describes the Exchange HTTP API. Local deployments are usually
served without an `/api` prefix. Production is served behind the `/api` base path
shown below.

Default local base URL:

```text
http://localhost:3000
```

Production base URL:

```text
https://exchange-api.gammaswap.com/api
```

## Conventions

- Most blockchain numeric values are encoded as decimal strings in JSON so they can safely represent `bigint` values.
- Amounts, sizes, and prices are in base units unless an endpoint says otherwise.
- Ethereum addresses are expected in hex address format. Signed request handlers normalize relevant address fields to lowercase before validating hashes and signatures.
- Signed POST endpoints accept EIP-712 payloads plus an `orderHash` and `signature`.
- `side` is a boolean order direction: `false` means buy, `true` means sell.
- `timeInForce` can be passed as a string or number-like value and is normalized to:

| Value | Name  | Meaning               |
| ----- | ----- | --------------------- |
| `0`   | `GTC` | Good until cancelled. |
| `1`   | `FOK` | Fill or kill.         |
| `2`   | `IOC` | Immediate or cancel.  |
| `3`   | `ALO` | Add liquidity only.   |

- `signatureType` values used by this API are:

| Value | Name    | Meaning                                 |
| ----- | ------- | --------------------------------------- |
| `0`   | `EOA`   | The sender signs directly.              |
| `4`   | `AGENT` | An approved agent signs for the sender. |

### Authentication

Signed POST endpoints use the same EIP-712 signing flow. Most requests contain one action object, such as `order`, `cancel`, `withdrawal`, `claim`, `approval`, or `revocation`, plus an `orderHash` and `signature`. `POST /cancel-replace` includes a signed `cancelReplace` action and a separately signed `replacement` order.

The field name `orderHash` is historical: for every signed endpoint it means "the EIP-712 digest of the signed action object." It is not a hash of the outer HTTP request body, and it does not include `signature`.

Clients compute signed action hashes in three steps:

1. Build or parse the action object so numeric fields are represented as exact integers.
2. Compute the action-specific struct hash with the action type hash and ABI-encoded fields in canonical order.
3. Compute the final EIP-712 digest:

```text
keccak256("\x19\x01" || domainSeparator || actionStructHash)
```

The EIP-712 domain is:

```text
name: GammaSwap Exchange
version: 2
chainId: request chainId
verifyingContract: exchange verifying contract
```

The client signs that digest directly and sends the original action object, `chainId`, `orderHash`, and `signature`. The API recomputes the same digest from the submitted action object and domain, recovers the signer from `signature`, and compares it with the action's `signer`.

This works because the digest commits to the exact action type, field names, field order, Solidity integer widths, addresses, chain id, and verifying contract. Changing any signed field changes the digest and invalidates the signature. The domain prevents replaying the same signed action against a different chain or verifying contract.

The `@gammaswap/v2-exchange-sdk` package exposes hash and signing helpers that can be used to construct direct API request bodies:

| Action object   | Endpoint               | Hash helper                |
| --------------- | ---------------------- | -------------------------- |
| `order`         | `POST /orders`         | `hashFillOrderJS`          |
| `cancel`        | `POST /cancels`        | `hashCancelOrderJS`        |
| `cancelReplace` | `POST /cancel-replace` | `hashCancelReplaceOrderJS` |
| `replacement`   | `POST /cancel-replace` | `hashFillOrderJS`          |
| `withdrawal`    | `POST /withdrawals`    | `hashWithdrawalOrderJS`    |
| `claim`         | `POST /claim`          | `hashClaimOrderJS`         |
| `approval`      | `POST /agents/approve` | `hashApproveAgentOrderJS`  |
| `revocation`    | `POST /agents/revoke`  | `hashRevokeAgentOrderJS`   |

`POST /agents/approve` also includes `approval.approvalSignature`, which is a signature over the inner agent approval hash. The helper for that inner hash is `hashAgentApprovalJS`.

Example for `POST /orders`:

```ts
import { getExchangeDomain, hashFillOrderJS, signOrderJS } from "@gammaswap/v2-exchange-sdk";

const order = {
  typ: 2n,
  nonce,
  signer: wallet.address,
  signatureType: 0n,
  sender: wallet.address,
  epoch,
  side: false,
  assetId,
  size,
  price,
  timeInForce: 0n,
  approvalNonce: 0n,
};

const domain = getExchangeDomain(chainId, verifyingContract);
const orderHash = hashFillOrderJS(order, domain);
const signature = signOrderJS(orderHash, wallet);

const body = {
  order: {
    typ: order.typ.toString(),
    nonce: order.nonce.toString(),
    signer: order.signer,
    signatureType: order.signatureType.toString(),
    sender: order.sender,
    epoch: order.epoch.toString(),
    side: order.side,
    assetId: order.assetId.toString(),
    size: order.size.toString(),
    price: order.price.toString(),
    timeInForce: order.timeInForce.toString(),
    approvalNonce: order.approvalNonce.toString(),
  },
  chainId: chainId.toString(),
  orderHash,
  signature,
};
```

For `POST /cancel-replace`, the replacement order is signed separately with `hashFillOrderJS(replacement, domain)`, and the cancel-replace action signs the resulting `replacementOrderHash` with `hashCancelReplaceOrderJS(cancelReplace, domain)`.

## Local API Scripts

The package scripts below exercise direct API requests from `scripts/api`:

| Script                          | Endpoint                                        |
| ------------------------------- | ----------------------------------------------- |
| `pnpm api:asset`                | `GET /asset/:assetId`                           |
| `pnpm api:balance`              | `GET /balance/:account`                         |
| `pnpm api:book`                 | `GET /book/:assetId/:epoch`                     |
| `pnpm api:book-orders`          | `GET /book/:assetId/:epoch/:account`            |
| `pnpm api:book-top`             | `GET /book/market/top/:assetId/:epoch`          |
| `pnpm api:position`             | `GET /position/:account/:assetId/:epoch`        |
| `pnpm api:resolution`           | `GET /resolve/:assetId/:epoch`                  |
| `pnpm api:last-resolution`      | `GET /resolve/last/epoch/:assetId`              |
| `pnpm api:agent:status`         | `GET /agents/status/:master`                    |
| `pnpm api:order`                | `POST /orders`                                  |
| `pnpm api:cancel`               | `POST /cancels`                                 |
| `pnpm api:cancel-replace`       | `POST /cancel-replace`                          |
| `pnpm api:claim`                | `POST /claim`                                   |
| `pnpm api:withdrawal`           | `POST /withdrawals`                             |
| `pnpm api:agent:approve`        | `POST /agents/approve`                          |
| `pnpm api:agent:revoke`         | `POST /agents/revoke`                           |
| `pnpm api:agent:order`          | `POST /orders` with `signatureType = 4`         |
| `pnpm api:agent:cancel`         | `POST /cancels` with `signatureType = 4`        |
| `pnpm api:agent:cancel-replace` | `POST /cancel-replace` with `signatureType = 4` |
| `pnpm api:agent:claim`          | `POST /claim` with `signatureType = 4`          |

`pnpm api:deposit` calls the DepositLedger contract directly and is not an HTTP API endpoint. `pnpm api:ws:book` and `pnpm api:ws:oracle` connect to WebSocket services rather than HTTP endpoints.

## Models

### Signed Request Wrapper

Most POST endpoints use this outer JSON shape:

| Field       | Type   | Description                                                        |
| ----------- | ------ | ------------------------------------------------------------------ |
| `chainId`   | string | Chain id used when signing. Agent routes require it to be present. |
| `orderHash` | string | EIP-712 hash of the signed action object.                          |
| `signature` | string | Signature over `orderHash`.                                        |

The action object field changes by endpoint, for example `order`, `cancel`, `cancelReplace`, `withdrawal`, `claim`, `approval`, or `revocation`. `POST /cancel-replace` also includes a `replacement` order, `replacementOrderHash`, and `replacementSignature`.

### Base Auth Fields

These fields appear inside most signed action objects:

| Field           | Type    | Description                                                                           |
| --------------- | ------- | ------------------------------------------------------------------------------------- |
| `typ`           | string  | Order type id. See the order type table below.                                        |
| `nonce`         | string  | Unique nonce for this signed action.                                                  |
| `signer`        | address | Address that signs the action. For agent requests, this is the agent address.         |
| `signatureType` | string  | Signature type. `0` for EOA, `4` for agent.                                           |
| `sender`        | address | Master account that owns the action. For EOA requests this normally matches `signer`. |

### Order Types

| Value | Name             | Used By                                                         |
| ----- | ---------------- | --------------------------------------------------------------- |
| `1`   | `WITHDRAWAL`     | `POST /withdrawals`                                             |
| `2`   | `FILL`           | `POST /orders`, replacement order inside `POST /cancel-replace` |
| `3`   | `CANCEL`         | `POST /cancels`                                                 |
| `5`   | `CLAIM`          | `POST /claim`                                                   |
| `61`  | `AGENT_APPROVE`  | `POST /agents/approve`                                          |
| `62`  | `AGENT_REVOKE`   | `POST /agents/revoke`                                           |
| `63`  | `CANCEL_REPLACE` | `POST /cancel-replace`                                          |

### L2Level

Used in order book responses.

| Field              | Type    | Description                                   |
| ------------------ | ------- | --------------------------------------------- |
| `price`            | string  | Price level.                                  |
| `size`             | string  | Aggregated size at this price level.          |
| `orderCount`       | number  | Number of resting orders at this price level. |
| `orders`           | array   | Optional per-order data at the level.         |
| `orders[].id`      | string  | Resting order id/hash.                        |
| `orders[].size`    | string  | Resting order size.                           |
| `orders[].price`   | number  | Resting order price.                          |
| `orders[].time`    | number  | Optional timestamp associated with the order. |
| `orders[].account` | address | Optional account that owns the order.         |

### NewOrderResponse

Returned by `POST /orders` and as the `replacement` field of `POST /cancel-replace`.

| Field       | Type   | Description                                                                                                                                             |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orderId`   | string | Order id/hash.                                                                                                                                          |
| `filled`    | string | Quantity filled by the relayer.                                                                                                                         |
| `remaining` | string | Quantity still open.                                                                                                                                    |
| `cancelled` | string | Quantity cancelled.                                                                                                                                     |
| `status`    | string | `ACCEPTED`, `CANCELLED`, `REJECTED`, `FILLED`, or `PARTIALLY_FILLED`.                                                                                   |
| `reason`    | string | Empty on normal success, or rejection reason such as `IOC`, `FOK`, `MARGIN`, `INVALID_ORDER`, `MARKET_RESOLVED`, `INTERNAL_ERROR`, `ALO`, or `UNKNOWN`. |

### CancelResponse

Returned by `POST /cancels` and inside `POST /cancel-replace`.

| Field      | Type     | Description                                                                                                                                                                                                                                                               |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | string   | Cancel request id/hash.                                                                                                                                                                                                                                                   |
| `orderIds` | string[] | Order ids affected by the cancel.                                                                                                                                                                                                                                         |
| `status`   | string   | `CANCELLED`, `CANCEL_FAILED`, or `CANCEL_NOT_COMMITTED`. `CANCEL_NOT_COMMITTED` means the cancel leg was valid, but was not journal-committed because the replacement leg failed and the cancel-replace request was treated atomically (e.g. allOrNothing flag was true). |

### CancelReplaceResponse

Returned by `POST /cancel-replace`.

| Field         | Type           | Description                                                                                 |
| ------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `id`          | string         | Cancel-replace request id/hash.                                                             |
| `cancel`      | object         | Cancel leg response. Uses `CancelResponse`.                                                 |
| `replacement` | object or null | Replacement order response. Uses `NewOrderResponse` when present.                           |
| `status`      | string         | `CANCEL_FAILED`, `REPLACEMENT_FAILED`, `CANCEL_COMMITTED_REPLACEMENT_FAILED`, or `SUCCESS`. |

### Simple Status Responses

| Model                       | Fields         | Description                                     |
| --------------------------- | -------------- | ----------------------------------------------- |
| `ClaimResponse`             | `id`, `status` | `status` is `CLAIMED` or `CLAIM_FAILED`.        |
| `WithdrawalRequestResponse` | `id`, `status` | `status` is `WITHDRAWN` or `WITHDRAWAL_FAILED`. |
| `ApproveAgentResponse`      | `id`, `status` | `status` is `SUCCESS` or `FAIL`.                |
| `RevokeAgentResponse`       | `id`, `status` | `status` is `SUCCESS` or `FAIL`.                |

## Endpoints

## System

### GET /health

Returns a basic liveness response.

#### Request

No path parameters, query parameters, or body.

#### Response: 200

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | Always `ok` when the server is healthy. |

Example:

```json
{
  "status": "ok"
}
```

## Account

### GET /balance/:account

Returns the current balance snapshot for an account.

#### Path Parameters

| Field     | Type    | Description               |
| --------- | ------- | ------------------------- |
| `account` | address | Account address to query. |

#### Response: 200

| Field     | Type    | Description                                                 |
| --------- | ------- | ----------------------------------------------------------- |
| `account` | address | Account address for the snapshot.                           |
| `ts`      | number  | Timestamp generated when the snapshot response is returned. |
| `balance` | string  | Available ledger balance.                                   |
| `pending` | string  | Pending ledger balance.                                     |

#### Errors

- `404 INVALID_ACCOUNT` when `account` is not a valid address.
- `404 BALANCE_NOT_FOUND` when no balance snapshot is available.
- `500 INTERNAL_ERROR` for unexpected failures.

## Position

### GET /position/:account/:assetId/:epoch

Returns the position snapshot for an account in a market epoch.

#### Path Parameters

| Field     | Type    | Description               |
| --------- | ------- | ------------------------- |
| `account` | address | Account address to query. |
| `assetId` | string  | Market asset id.          |
| `epoch`   | string  | Market epoch.             |

#### Response: 200

| Field     | Type    | Description                                                                              |
| --------- | ------- | ---------------------------------------------------------------------------------------- |
| `account` | address | Account address for the position.                                                        |
| `assetId` | string  | Market asset id.                                                                         |
| `epoch`   | string  | Market epoch.                                                                            |
| `ts`      | number  | Position snapshot timestamp.                                                             |
| `size`    | string  | Position size.                                                                           |
| `margin`  | string  | Position margin.                                                                         |
| `balance` | string  | Position balance.                                                                        |
| `pnl`     | string  | Profit and loss for the position (only updates when position is closed and not flipped). |
| `side`    | boolean | Position side.                                                                           |
| `bSide`   | boolean | Balance side flag.                                                                       |
| `mSide`   | boolean | Margin side flag.                                                                        |
| `pSide`   | boolean | PnL side flag.                                                                           |

#### Errors

- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 POSITION_NOT_FOUND`
- `500 INTERNAL_ERROR`

## Assets

### GET /asset/:assetId

Returns registered asset metadata for the latest/current asset state.

#### Path Parameters

| Field     | Type   | Description      |
| --------- | ------ | ---------------- |
| `assetId` | string | Market asset id. |

#### Response: 200

| Field         | Type    | Description                                               |
| ------------- | ------- | --------------------------------------------------------- |
| `assetId`     | string  | Market asset id from the request.                         |
| `epoch`       | string  | Current asset epoch (starts at epoch 0).                  |
| `registered`  | boolean | Whether the asset is registered.                          |
| `expiration`  | string  | Current expiration timestamp in unix seconds.             |
| `assetType`   | string  | Asset type id (1 = single epoch, 2 = recurring epoch).    |
| `strikePrice` | string  | Strike price for the current asset epoch (price to beat). |
| `ledger`      | address | Ledger contract address associated with the asset.        |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ASSET_NOT_FOUND`
- `500 INTERNAL_ERROR`

## Order Book

### GET /book/market/top/:assetId/:epoch

Returns the top of book for a market epoch.

#### Path Parameters

| Field     | Type   | Description      |
| --------- | ------ | ---------------- |
| `assetId` | string | Market asset id. |
| `epoch`   | string | Market epoch.    |

#### Response: 200

| Field     | Type   | Description                                             |
| --------- | ------ | ------------------------------------------------------- |
| `assetId` | string | Market asset id from the request.                       |
| `epoch`   | string | Market epoch from the request.                          |
| `seqId`   | number | Order book sequence id.                                 |
| `ts`      | number | Snapshot timestamp.                                     |
| `bid`     | object | Best bid level. Uses `L2Level`.                         |
| `ask`     | object | Best ask level. Uses `L2Level`.                         |
| `last`    | string | Last traded price or last book value from the snapshot. |
| `lastTs`  | string | Timestamp for the `last` value.                         |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ORDERBOOK_NOT_FOUND`
- `500 INTERNAL_ERROR`

### GET /book/:assetId/:epoch

Returns an order book snapshot for a market epoch.

#### Path Parameters

| Field     | Type   | Description      |
| --------- | ------ | ---------------- |
| `assetId` | string | Market asset id. |
| `epoch`   | string | Market epoch.    |

#### Query Parameters

| Field   | Type   | Default | Description                                                                 |
| ------- | ------ | ------- | --------------------------------------------------------------------------- |
| `depth` | number | `200`   | Maximum number of bid and ask levels to return. Clamped from `1` to `5000`. |

#### Response: 200

| Field     | Type   | Description                       |
| --------- | ------ | --------------------------------- |
| `assetId` | string | Market asset id from the request. |
| `epoch`   | string | Market epoch from the request.    |
| `ts`      | number | Snapshot timestamp.               |
| `seqId`   | number | Order book sequence id.           |
| `bids`    | array  | Bid levels, each using `L2Level`. |
| `asks`    | array  | Ask levels, each using `L2Level`. |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ORDERBOOK_NOT_FOUND`
- `500 INTERNAL_ERROR`

### GET /book/:assetId/:epoch/:account

Returns resting book orders owned by one account.

#### Path Parameters

| Field     | Type    | Description                                      |
| --------- | ------- | ------------------------------------------------ |
| `assetId` | string  | Market asset id.                                 |
| `epoch`   | string  | Market epoch.                                    |
| `account` | address | Account address whose orders should be returned. |

#### Response: 200

| Field     | Type   | Description                                              |
| --------- | ------ | -------------------------------------------------------- |
| `assetId` | string | Market asset id from the request.                        |
| `epoch`   | string | Market epoch from the request.                           |
| `seqId`   | number | Order book sequence id.                                  |
| `ts`      | number | Snapshot timestamp.                                      |
| `buys`    | array  | Account-owned bid orders found in level `orders` arrays. |
| `sells`   | array  | Account-owned ask orders found in level `orders` arrays. |

Each item in `buys` and `sells` is the per-order item from an `L2Level.orders` array.

#### Errors

- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ORDERBOOK_NOT_FOUND`
- `500 INTERNAL_ERROR`

## Orders

### POST /orders

Submits a signed order and waits for the relayer response.

#### Request Body

| Field                 | Type    | Description                                   |
| --------------------- | ------- | --------------------------------------------- |
| `order`               | object  | EIP-712 order payload.                        |
| `order.typ`           | string  | Must be `2` for `FILL`.                       |
| `order.nonce`         | string  | Unique nonce for this order.                  |
| `order.signer`        | address | Address that signed the order hash.           |
| `order.signatureType` | string  | `0` for EOA or `4` for an approved agent.     |
| `order.sender`        | address | Account that owns the order.                  |
| `order.epoch`         | string  | Market epoch.                                 |
| `order.side`          | boolean | `false` for buy, `true` for sell.             |
| `order.assetId`       | string  | Market asset id.                              |
| `order.size`          | string  | Order size.                                   |
| `order.price`         | string  | Limit price.                                  |
| `order.timeInForce`   | string  | Time in force: `0`, `1`, `2`, or `3`.         |
| `order.approvalNonce` | string  | Agent approval nonce. Use `0` for EOA orders. |
| `chainId`             | string  | Chain id used when signing.                   |
| `orderHash`           | string  | EIP-712 hash of `order`.                      |
| `signature`           | string  | Signature over `orderHash`.                   |

#### Response: 202

Returns `NewOrderResponse`.

#### Errors

- `400 MISSING_ORDER_OR_SIGNATURE`
- `400 INVALID_TIME_IN_FORCE`
- `400 INVALID_PRICE`
- `400 INVALID_SIZE`
- `400 Invalid auth parameters`
- `400 Invalid order parameters`
- `400 ASSET_ID_NOT_AVAILABLE`
- `401 ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ENTRY_PROCESSED`
- `404 ORDER_NOT_FOUND`
- agent auth errors from the agent approval checks
- `500 Internal enqueue error`

## Cancels

### POST /cancels

Submits a signed cancel request. Passing the zero hash as `cancel.orderHash` requests cancel-all.

#### Request Body

| Field                  | Type    | Description                                              |
| ---------------------- | ------- | -------------------------------------------------------- |
| `cancel`               | object  | EIP-712 cancel payload.                                  |
| `cancel.typ`           | string  | Must be `3` for `CANCEL`.                                |
| `cancel.nonce`         | string  | Unique nonce for this cancel.                            |
| `cancel.signer`        | address | Address that signed the cancel hash.                     |
| `cancel.signatureType` | string  | `0` for EOA or `4` for an approved agent.                |
| `cancel.sender`        | address | Account that owns the order being cancelled.             |
| `cancel.assetId`       | string  | Market asset id.                                         |
| `cancel.epoch`         | string  | Market epoch.                                            |
| `cancel.orderHash`     | string  | Order id/hash to cancel. Zero hash means cancel all.     |
| `cancel.approvalNonce` | string  | Agent approval nonce. Use `0` for EOA cancels.           |
| `chainId`              | string  | Chain id used when signing.                              |
| `orderHash`            | string  | EIP-712 hash of `cancel`. This is the cancel request id. |
| `signature`            | string  | Signature over `orderHash`.                              |

#### Response: 202

Returns `CancelResponse`.

#### Errors

- `400 MISSING_CANCEL_OR_SIGNATURE`
- `400 Invalid auth parameters`
- `400 Invalid cancel parameters`
- `400 ORDER_NOT_FOUND`
- `401 CANCEL_ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 ENTRY_PROCESSED`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ORDERBOOK_NOT_FOUND`
- `404 CANCELLATION_NOT_FOUND`
- agent auth errors from the agent approval checks
- `500 Unable to check order status on-chain`
- `500 Internal enqueue error`

## Cancel Replace

### POST /cancel-replace

Cancels one existing order and submits a replacement order in one signed request. Cancel-all is not supported for this endpoint.
Side of replacement order must match the side of the cancelled order.

#### Request Body

| Field                                | Type    | Description                                                                             |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------- |
| `cancelReplace`                      | object  | EIP-712 cancel-replace payload.                                                         |
| `cancelReplace.typ`                  | string  | Must be `63` for `CANCEL_REPLACE`.                                                      |
| `cancelReplace.nonce`                | string  | Unique nonce for the cancel-replace action.                                             |
| `cancelReplace.signer`               | address | Address that signed the cancel-replace hash.                                            |
| `cancelReplace.signatureType`        | string  | `0` for EOA or `4` for an approved agent.                                               |
| `cancelReplace.sender`               | address | Account that owns the cancelled and replacement orders.                                 |
| `cancelReplace.assetId`              | string  | Market asset id. Must match `replacement.assetId`.                                      |
| `cancelReplace.epoch`                | string  | Market epoch. Must match `replacement.epoch`.                                           |
| `cancelReplace.cancelOrderHash`      | string  | Existing order id/hash to cancel. Cannot be zero hash.                                  |
| `cancelReplace.replacementOrderHash` | string  | EIP-712 hash of the replacement order.                                                  |
| `cancelReplace.approvalNonce`        | string  | Agent approval nonce. Must match `replacement.approvalNonce`.                           |
| `cancelReplace.allOrNothing`         | boolean | Whether the combined action should be all-or-nothing. Defaults to `false` when omitted. |
| `replacement`                        | object  | Replacement EIP-712 order payload. Same fields as `POST /orders` `order`.               |
| `chainId`                            | string  | Chain id used when signing.                                                             |
| `orderHash`                          | string  | EIP-712 hash of `cancelReplace`.                                                        |
| `signature`                          | string  | Signature over `orderHash`.                                                             |
| `replacementOrderHash`               | string  | EIP-712 hash of `replacement`.                                                          |
| `replacementSignature`               | string  | Signature over `replacementOrderHash`.                                                  |

#### Response: 202

Returns `CancelReplaceResponse`.

#### Errors

- `400 MISSING_CANCEL_REPLACE_OR_SIGNATURE`
- `400 INVALID_ALL_OR_NOTHING`
- `400 INVALID_REPLACEMENT_TIME_IN_FORCE`
- `400 INVALID_CANCEL_REPLACE_TYPE`
- `400 INVALID_REPLACEMENT_TYPE`
- `400 MISSING_APPROVAL_NONCE`
- `400 SIGNATURE_TYPE_MISMATCH`
- `400 INVALID_SIGNATURE_TYPE`
- `400 EOA_SIGNER_AND_SENDER_MUST_MATCH`
- `400 SENDER_MISMATCH`
- `400 SIGNER_MISMATCH`
- `400 APPROVAL_NONCE_MISMATCH`
- `400 CROSS_MARKET_CANCEL_REPLACE_NOT_SUPPORTED`
- `400 CANCEL_REPLACE_CANCEL_ALL_NOT_SUPPORTED`
- `400 INVALID_PRICE`
- `400 INVALID_SIZE`
- `400 Invalid auth parameters`
- `400 Invalid replacement order parameters`
- `400 Invalid cancel replace parameters`
- `400 ASSET_ID_NOT_AVAILABLE`
- `400 ORDER_NOT_FOUND`
- `400 REPLACEMENT_SIDE_MISMATCH`
- `401 REPLACEMENT_ORDER_HASH_MISMATCH`
- `401 CANCEL_REPLACE_ORDER_HASH_MISMATCH`
- `401 INVALID_CANCEL_REPLACE_SIGNATURE`
- `401 INVALID_REPLACEMENT_SIGNATURE`
- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ENTRY_PROCESSED`
- `404 REPLACEMENT_ENTRY_PROCESSED`
- `404 ORDERBOOK_NOT_FOUND`
- `404 CANCEL_REPLACE_NOT_FOUND`
- agent auth errors from the agent approval checks
- `500 Internal enqueue error`

## Withdrawals

### POST /withdrawals

Submits a signed withdrawal request.

#### Request Body

| Field                      | Type    | Description                                  |
| -------------------------- | ------- | -------------------------------------------- |
| `withdrawal`               | object  | EIP-712 withdrawal payload.                  |
| `withdrawal.typ`           | string  | Must be `1` for `WITHDRAWAL`.                |
| `withdrawal.nonce`         | string  | Unique nonce for this withdrawal.            |
| `withdrawal.signer`        | address | Address that signed the withdrawal hash.     |
| `withdrawal.signatureType` | string  | Signature type. Use `0` for EOA withdrawals. |
| `withdrawal.sender`        | address | Account paying the withdrawal.               |
| `withdrawal.receiver`      | address | Account receiving withdrawn funds.           |
| `withdrawal.amount`        | string  | Amount to withdraw.                          |
| `withdrawal.ledger`        | address | Ledger contract address.                     |
| `chainId`                  | string  | Chain id used when signing.                  |
| `orderHash`                | string  | EIP-712 hash of `withdrawal`.                |
| `signature`                | string  | Signature over `orderHash`.                  |

#### Response: 202

Returns `WithdrawalRequestResponse`.

#### Errors

- `400 MISSING_WITHDRAWAL_OR_SIGNATURE`
- `400 INVALID_AUTH_PARAMETERS`
- `400 INVALID_WITHDRAWAL_PARAMETERS`
- `400 INSUFFICIENT_LEDGER_BALANCE`
- `401 WITHDRAWAL_ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `404 ENTRY_PROCESSED`
- `404 WITHDRAWAL_REQUEST_NOT_FOUND`
- `500 Unable to check wallet ledger balance on-chain`
- `500 Internal enqueue error`

## Claims

### GET /claim/:assetId/:epoch/:account

Returns the amount claimable by an account for a resolved asset epoch.

#### Path Parameters

| Field | Type | Description |
| --- | --- | --- |
| `assetId` | string | Market asset id. |
| `epoch` | string | Market epoch. |
| `account` | address | Account address to query. |

#### Response: 200

| Field | Type | Description |
| --- | --- | --- |
| `account` | address | Account address from the request. |
| `assetId` | string | Market asset id from the request. |
| `epoch` | string | Market epoch from the request. |
| `claimable` | string | Claimable amount. |

#### Errors

- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ASSET_NOT_FOUND`
- `404 EPOCH_NOT_RESOLVED`
- `500 INTERNAL_ERROR`

### POST /claim

Submits a signed claim request.

#### Request Body

| Field                 | Type    | Description                                   |
| --------------------- | ------- | --------------------------------------------- |
| `claim`               | object  | EIP-712 claim payload.                        |
| `claim.typ`           | string  | Must be `5` for `CLAIM`.                      |
| `claim.nonce`         | string  | Unique nonce for this claim.                  |
| `claim.signer`        | address | Address that signed the claim hash.           |
| `claim.signatureType` | string  | `0` for EOA or `4` for an approved agent.     |
| `claim.sender`        | address | Account claiming funds.                       |
| `claim.assetId`       | string  | Market asset id.                              |
| `claim.epoch`         | string  | Market epoch.                                 |
| `claim.approvalNonce` | string  | Agent approval nonce. Use `0` for EOA claims. |
| `chainId`             | string  | Chain id used when signing.                   |
| `orderHash`           | string  | EIP-712 hash of `claim`.                      |
| `signature`           | string  | Signature over `orderHash`.                   |

#### Response: 202

Returns `ClaimResponse`.

#### Errors

- `400 MISSING_CLAIM_OR_SIGNATURE`
- `400 Invalid auth parameters`
- `400 Invalid claim parameters`
- `401 ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `404 INVALID_ACCOUNT`
- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `404 ENTRY_PROCESSED`
- `404 ASSET_ID_NOT_REGISTERED`
- `404 ASSET_NOT_FOUND`
- `404 EPOCH_NOT_RESOLVED`
- `404 NO_CLAIMABLE_AMOUNT`
- `404 CLAIM_NOT_FOUND`
- agent auth errors from the agent approval checks
- `500 INTERNAL_ERROR`

## Resolution

### GET /resolve/mark/:assetId

Returns the current oracle mark price for the decoded base asset id.

#### Path Parameters

| Field | Type | Description |
| --- | --- | --- |
| `assetId` | string | Market asset id. |

#### Response: 200

| Field | Type | Description |
| --- | --- | --- |
| `assetId` | string | Market asset id from the request. |
| `id` | number | Decoded base asset id. |
| `ts` | string | Current timestamp. |
| `price` | string | Current oracle price. |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 ASSET_ID_NOT_REGISTERED`
- `500 Unable to get current price`
- `500 Internal enqueue error`

### GET /resolve/settlement/:assetId/:epoch

Returns the settlement price for an expired and resolved asset epoch.

#### Path Parameters

| Field | Type | Description |
| --- | --- | --- |
| `assetId` | string | Market asset id. |
| `epoch` | string | Market epoch. |

#### Response: 200

| Field | Type | Description |
| --- | --- | --- |
| `assetId` | string | Market asset id from the request. |
| `epoch` | string | Market epoch from the request. |
| `id` | number | Decoded base asset id. |
| `ts` | number | Current timestamp. |
| `expirationTime` | number | Expiration timestamp for the asset epoch. |
| `settlementPrice` | string | Settlement price. |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `400 ASSET_ID_NOT_AVAILABLE`
- `404 ASSET_ID_NOT_EXPIRED`
- `404 ASSET_ID_NOT_RESOLVED`
- `500 Unable to get settlement price`
- `500 Internal enqueue error`

### GET /resolve/:assetId/:epoch

Returns a stored resolution price for an asset epoch.

#### Path Parameters

| Field     | Type   | Description      |
| --------- | ------ | ---------------- |
| `assetId` | string | Market asset id. |
| `epoch`   | string | Market epoch.    |

#### Response: 200

| Field     | Type    | Description                            |
| --------- | ------- | -------------------------------------- |
| `assetId` | string  | Market asset id from the request.      |
| `epoch`   | string  | Market epoch from the request.         |
| `id`      | number  | Decoded base asset id.                 |
| `ts`      | string  | Resolution timestamp.                  |
| `price`   | string  | Resolution price.                      |
| `isNull`  | boolean | Whether the resolution is marked null. |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 INVALID_EPOCH`
- `400 ASSET_ID_NOT_AVAILABLE`
- `404 RESOLUTION_NOT_FOUND`
- `500 Internal enqueue error`

### GET /resolve/last/epoch/:assetId

Returns the latest stored resolution price for an asset.

#### Path Parameters

| Field     | Type   | Description      |
| --------- | ------ | ---------------- |
| `assetId` | string | Market asset id. |

#### Response: 200

| Field     | Type    | Description                            |
| --------- | ------- | -------------------------------------- |
| `assetId` | string  | Market asset id from the request.      |
| `epoch`   | string  | Latest resolved epoch.                 |
| `id`      | number  | Decoded base asset id.                 |
| `ts`      | string  | Resolution timestamp.                  |
| `price`   | string  | Resolution price.                      |
| `isNull`  | boolean | Whether the resolution is marked null. |

#### Errors

- `404 INVALID_ASSET_ID`
- `404 RESOLUTION_NOT_FOUND`
- `500 Internal enqueue error`

## Agents

### POST /agents/approve

Approves an agent to sign actions for a master account.

#### Request Body

| Field                        | Type    | Description                                                      |
| ---------------------------- | ------- | ---------------------------------------------------------------- |
| `approval`                   | object  | EIP-712 approve-agent payload.                                   |
| `approval.typ`               | string  | Must be `61` for `AGENT_APPROVE`.                                |
| `approval.nonce`             | string  | Unique nonce for this approval transaction.                      |
| `approval.signer`            | address | Must be the master account address.                              |
| `approval.signatureType`     | string  | Must be `0` for EOA.                                             |
| `approval.sender`            | address | Master account approving the agent.                              |
| `approval.agent`             | address | Agent address being approved.                                    |
| `approval.approvalNonce`     | string  | Approval expiration/nonce timestamp. Must be in the near future. |
| `approval.approvalSignature` | string  | Master signature over the agent approval hash.                   |
| `chainId`                    | string  | Chain id. This field is required by the route.                   |
| `orderHash`                  | string  | EIP-712 hash of `approval`.                                      |
| `signature`                  | string  | Signature over `orderHash`.                                      |

#### Response: 202

Returns `ApproveAgentResponse`.

#### Errors

- `400 MISSING_APPROVAL_OR_SIGNATURE`
- `400 INVALID_MASTER`
- `400 INVALID_AGENT`
- `400 AGENT_CANNOT_APPROVE_ITSELF`
- `400 SENDER_MUST_BE_SIGNER`
- `400 UNSUPPORTED_SIGNATURE_TYPE`
- `400 NONCE_TOO_FAR_IN_FUTURE`
- `400 NONCE_IN_THE_PAST`
- `400 Invalid auth parameters`
- `400 Invalid order parameters`
- `401 APPROVE_AGENT_ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `401 INVALID_APPROVAL_SIGNATURE`
- `404 ENTRY_PROCESSED`
- `404` with a failed approval response when relayer status is `FAIL`
- `429` for agent rate limit failures
- `500 INTERNAL_ERROR`

### POST /agents/revoke

Revokes the current agent approval for a master account.

#### Request Body

| Field                      | Type    | Description                                    |
| -------------------------- | ------- | ---------------------------------------------- |
| `revocation`               | object  | EIP-712 revoke-agent payload.                  |
| `revocation.typ`           | string  | Must be `62` for `AGENT_REVOKE`.               |
| `revocation.nonce`         | string  | Unique nonce for this revocation.              |
| `revocation.signer`        | address | Must match `revocation.sender`.                |
| `revocation.signatureType` | string  | Must be `0` for EOA.                           |
| `revocation.sender`        | address | Master account revoking the agent.             |
| `chainId`                  | string  | Chain id. This field is required by the route. |
| `orderHash`                | string  | EIP-712 hash of `revocation`.                  |
| `signature`                | string  | Signature over `orderHash`.                    |

#### Response: 202

Returns `RevokeAgentResponse`.

#### Errors

- `400 MISSING_REVOKE_OR_SIGNATURE`
- `400 SIGNER_NOT_SENDER`
- `400 UNSUPPORTED_SIGNATURE_TYPE`
- `400 Invalid auth parameters`
- `400 Invalid order parameters`
- `401 REVOKE_ORDER_HASH_MISMATCH`
- `401 INVALID_SIGNATURE`
- `404 ENTRY_PROCESSED`
- `404` with a failed revocation response when relayer status is `FAIL`
- `429` for agent rate limit failures
- `500 INTERNAL_ERROR`

### GET /agents/status/:master

Returns current agent approval status for a master account.

#### Path Parameters

| Field    | Type    | Description             |
| -------- | ------- | ----------------------- |
| `master` | address | Master account address. |

#### Response: 202

| Field    | Type                    | Description                                                      |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| `agent`  | address or empty string | Approved agent address, or empty string when no approval exists. |
| `nonce`  | string                  | Approval nonce or expiration timestamp. `0` when inactive.       |
| `status` | string                  | `active`, `inactive`, or `expired`.                              |

#### Errors

- `400 INVALID_MASTER`
- `500 INTERNAL_ERROR`
