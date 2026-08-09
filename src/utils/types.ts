import type { Side } from "../config/config.js";

export type BookLevel = {
    price: number;
    size: number ;
    orderCount: number;
    orders: PendingOrder[];
};

export type BookSnapshot = {
    assetId: bigint;
    epoch: bigint;
    seqId: bigint;
    ts: bigint;
    bids: BookLevel[];
    asks: BookLevel[];
};

export type BalanceSnapshot = {
    account: string,
    ts: number,
    balance: bigint,
    pending: bigint,
}

export type ApiBalancesResponse = BalanceSnapshot

export interface OrderKey {
    price: number;
    time: number;
    id: string;
}

export type CancelReplaceInstruction = {
    price: number;
    size: number;
    side: Side;
    cancelId: string;
}

export type NewOrderInstruction = {
    price: number;
    size: number;
    side: Side;
}

export type PendingOrder = {
    id: string;
    price: number;
    size: number;
    side: Side;
    time: number;
    account: string;
    epoch: bigint;
};

export type Position = {
    txId: bigint;
    size: bigint;
    balance: bigint;
    margin: bigint;
    pnl: bigint
    side: boolean;
    bSide: boolean;
    mSide: boolean;
    pSide: boolean;
    claimed: boolean;
};

export type PositionSnapshot = {
    account: string,
    assetId: bigint,
    epoch: bigint,
    ts: number,
    size: bigint,
    margin: bigint,
    balance: bigint,
    pnl: bigint,
    side: boolean,
    bSide: boolean,
    mSide: boolean,
    pSide: boolean
}

export type ApiPositionResponse = PositionSnapshot

export type ApiPendingResponse = {
    assetId: bigint;
    ts: bigint;
    epoch: bigint;
    buys: PendingOrder[];
    sells: PendingOrder[];
};

export type ApiResolutionPriceResponse = {
    assetId: bigint;
    epoch: bigint;
    price: bigint;
    id: number;
    ts: bigint;
    isNull: boolean;
};

export type ApiBookResponse = BookSnapshot;

export interface Asset {
    strikePrice: bigint;
    oracle: string;
    expiration: bigint;
    assetType: bigint;
    registered: boolean;
    epoch: bigint;
}

export interface AssetEpochData {
    expiration: bigint;
    strikePrice: bigint;
    resolutionPrice: bigint;
}

/**
 * AssetId encoding/decoding utilities
 *
 * Matches PackedAssetId.sol (MarginExchange): LSB-first bit packing.
 * - id: 64 bits (0-63)
 * - marketType: 8 bits (64-71)
 * - startTime: 32 bits (72-103)
 * - periodLength: 32 bits (104-135)
 * - strike: 48 bits (136-183) — strike
 * - strike: 16 bits (184-199) — range
 * - reserved: 56 bits (200-255)
 *
 * expiration (not packed) = startTime + periodLength (when the market settles).
 */
export interface DecodedAssetId {
    id: number;           // uint64 — base asset id
    marketType: number;   // uint8 — asset type (1 = up/down, etc.)
    startTime: number;    // uint32 — market start timestamp
    periodLength: number; // uint32 — period in seconds (e.g. 900 for 15m)
    strike: string;       // uint48 — strike/priceChange per asset type
    range: number;        // uint16 — range
    reserved: string;     // uint56 — reserved
    expiration: number;   // startTime + periodLength (convenience)
}
