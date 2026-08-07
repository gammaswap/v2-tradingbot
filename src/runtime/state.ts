import { CFG } from "../config/config.js";
import type { Asset, BookSnapshot, PendingOrder, OrderKey } from "../utils/types.js";
import { TreeMap } from "data-structure-typed";

function compareSellOrderKeys(a: OrderKey, b: OrderKey): number {
    // Best sell price first: lower price wins
    if (a.price !== b.price) {
        return a.price - b.price;
    }

    // Same price: earlier order wins
    if (a.time !== b.time) {
        return a.time - b.time;
    }

    // Same price and time: unique deterministic tie-breaker
    return a.id.localeCompare(b.id);
}

function compareBuyOrderKeys(a: OrderKey, b: OrderKey): number {
    if (a.price !== b.price) {
        return b.price - a.price;
    }

    if (a.time !== b.time) {
        return a.time - b.time;
    }

    return a.id.localeCompare(b.id);
}

export const STATE = {
    asset: null as Asset | null,
    book: null as BookSnapshot | null,
    pending: new Map<string, PendingOrder>(),
    pendingBuys: new TreeMap<OrderKey, PendingOrder>(
        [],
        { comparator: compareBuyOrderKeys },
    ),
    pendingSells: new TreeMap<OrderKey, PendingOrder>(
        [],
        { comparator: compareSellOrderKeys },
    ),
    localOrderTs: new Map<string, number>(),

    // optional local ledger (first iteration)
    baseBal: 0,
    invBase: 0,
    epoch: 0n,

    lastMid: CFG.CENTER_PRICE,
    fairValue: null as {
        protocolPrice: number;
        probability: number;
        spot: bigint;
        strike: bigint;
        expiresInSec: number;
        updatedAtMs: number;
    } | null,

    oracle: {
        symbolId: CFG.SYMBOL_ID,
        price: null as bigint | null,
        ts: null as bigint | null,
        receivedAtMs: 0,
        stale: true,
        connected: false,
    },

    account: CFG.USER_ADDRESS,
    lastTradeTime: 0
};
