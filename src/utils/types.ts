import type { Side } from "../config/config.js";

export type BookLevel = {
    price: number;
    size: number ;
    orderCount: number;
    orders: PendingOrder[];
};

export type BookSnapshot = {
    assetId: bigint;
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
