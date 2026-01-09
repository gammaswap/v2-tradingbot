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

export type PendingOrder = {
    id: string;
    price: number;
    size: number;
    time?: number;
    account: string;
    side?: Side;
};

export type ApiPendingResponse = {
    assetId: bigint;
    ts: bigint;
    buys: PendingOrder[];
    sells: PendingOrder[];
};

export type ApiBookResponse = BookSnapshot;

export interface Eip712Deposit {
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    expiration: bigint;
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
    nonce: bigint;
    salt: bigint;
    signer: string;
    signatureType: bigint;
    sender: string;
    side: boolean;
    assetId: bigint;
    size: bigint;
    price: bigint;
}

export interface SignedOrderMessage {
    order: Eip712Order;
    chainId: bigint;
    orderHash: string;
    signature: string;
}

export interface Eip712Withdrawal {
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
    nonce: bigint; // must be unique in every transaction the user sends
    salt: bigint; // this is used to generate a hash which represents the orderId
    signer: string;
    signatureType: bigint;
    sender: string;
    assetId: bigint;
    orderHash: string;
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
}