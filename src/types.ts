import type { Side } from "./config.js";

export type BookLevel = { price: number; size: number };

export type BookSnapshot = {
    bids: BookLevel[];
    asks: BookLevel[];
};

export type PendingOrder = {
    id: string;
    side: Side;
    price: number;
    size: number;
    ts?: number;
};

export type ApiPendingResponse = {
    orders: PendingOrder[];
};

export type ApiBookResponse = BookSnapshot;
