import { CFG } from "../config/config.js";
import { decodeAssetId, getSymbolIdFromAssetId } from "../utils/assetIdUtils.js";
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

export type RuntimeState = {
    asset: Asset | null;
    periodLength: number | null;
    book: BookSnapshot | null;
    bookUpdatedAtMs: number;
    pending: Map<string, PendingOrder>;
    pendingBuys: TreeMap<OrderKey, PendingOrder>;
    pendingSells: TreeMap<OrderKey, PendingOrder>;
    localOrderTs: Map<string, number>;
    accountBalance: number;
    baseBal: number;
    invBase: number;
    epoch: bigint;
    lastMid: number;
    fairValue: {
        protocolPrice: number;
        probability: number;
        spot: bigint;
        strike: bigint;
        expiresInSec: number;
        updatedAtMs: number;
    } | null;
    oracle: {
        symbolId: string;
        price: bigint | null;
        ts: bigint | null;
        receivedAtMs: number;
        stale: boolean;
        connected: boolean;
    };
    account: string;
    lastTradeTime: number;
};

export function createInitialState(config = CFG): RuntimeState {
    return {
        asset: null,
        periodLength: null,
        book: null,
        bookUpdatedAtMs: 0,
        pending: new Map(),
        pendingBuys: new TreeMap([], { comparator: compareBuyOrderKeys }),
        pendingSells: new TreeMap([], { comparator: compareSellOrderKeys }),
        localOrderTs: new Map(),
        accountBalance: 0,
        baseBal: 0,
        invBase: 0,
        epoch: 0n,
        lastMid: config.CENTER_PRICE,
        fairValue: null,
        oracle: {
            symbolId: "",
            price: null,
            ts: null,
            receivedAtMs: 0,
            stale: true,
            connected: false,
        },
        account: "",
        lastTradeTime: 0,
    };
}

export function initializePeriodLength(
    state: RuntimeState,
    assetId: bigint,
): void {
    const { periodLength } = decodeAssetId(assetId);

    if (!Number.isSafeInteger(periodLength) || periodLength <= 0) {
        throw new Error(`asset ${assetId} has invalid periodLength: ${periodLength}`);
    }

    if (state.periodLength !== null && state.periodLength !== periodLength) {
        throw new Error(
            `asset periodLength changed from ${state.periodLength} to ${periodLength}`,
        );
    }

    state.periodLength = periodLength;
    state.oracle.symbolId = getSymbolIdFromAssetId(assetId);
}

export const STATE = createInitialState();
