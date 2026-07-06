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

export type PendingOrder = {
    id: string;
    price: number;
    size: number;
    time?: number;
    account: string;
    side?: Side;
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

export interface Eip712Deposit {
    typ: bigint;
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    amount: bigint;
    token: string;
    ledger: string;
    permitNonce: bigint; // must be unique for every permit (needs to be put in the hash of the contract)
    permitSignature: string;
}

export interface SignedDepositMessage {
    deposit: Eip712Deposit;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface Eip712Order {
    typ: bigint;
    nonce: bigint;
    salt: bigint;
    signer: string;
    signatureType: bigint;
    sender: string;
    epoch: bigint;
    side: boolean;
    assetId: bigint;
    size: bigint;
    price: bigint;
    timeInForce: bigint;
    approvalNonce: bigint;
}

export interface SignedOrderMessage {
    order: Eip712Order;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface Eip712Withdrawal {
    typ: bigint;
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    receiver: string;
    amount: bigint;
    ledger: string;
}

export interface SignedWithdrawalMessage {
    withdrawal: Eip712Withdrawal;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface Eip712Cancel {
    typ: bigint;
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    assetId: bigint;
    epoch: bigint;
    orderHash: string;
    approvalNonce: bigint;
}

export interface Eip712Claim {
    typ: bigint;
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    assetId: bigint;
    epoch: bigint;
    approvalNonce: bigint;
}

export interface SignedClaimMessage {
    claim: Eip712Claim;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface SignedCancelMessage {
    cancel: Eip712Cancel;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface OrderStatus {
    sender: string;
    isFilledOrCancelled: boolean;
    orderType: bigint;
    remaining: bigint;
}

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

export const OrderType = {
    DEPOSIT: 0n,
    WITHDRAWAL: 1n,
    FILL: 2n,
    CANCEL: 3n,
    RESOLUTION: 4n,
    CLAIM: 5n,
}