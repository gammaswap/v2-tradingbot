import {
    type WebSocketMarketUpdate,
    type WebSocketOrderUpdate,
    type WebSocketTradeUpdate,
    type WebSocketCancelUpdate,
} from "@gammaswap/v2-exchange-sdk";
import { TreeMap } from "data-structure-typed";
import type { Side } from "../config/config.js";
import type { BookLevel, BookSnapshot, PendingOrder } from "../utils/types.js";

type MutablePriceLevel = {
    price: number;
    size: number;
    orders: Map<string, PendingOrder>;
    snapshot: BookLevel;
};

export type LocalBookOrder = PendingOrder;

export type LocalOrderBookState = {
    assetId: bigint;
    epoch: bigint | null;
    seqId: bigint | null;
    ts: bigint;
    orders: Map<string, LocalBookOrder>;
    bidsByPrice: TreeMap<number, MutablePriceLevel>;
    asksByPrice: TreeMap<number, MutablePriceLevel>;
    buffered: WebSocketMarketUpdate[];
    needsResync: boolean;
};

export type MarketApplyResult =
    | "applied"
    | "duplicate"
    | "ignored"
    | "ignored-epoch"
    | "buffered"
    | "invalid";

export function createLocalOrderBookState(assetId: bigint): LocalOrderBookState {
    return {
        assetId,
        epoch: null,
        seqId: null,
        ts: 0n,
        orders: new Map(),
        bidsByPrice: new TreeMap([], { comparator: (a, b) => b - a }),
        asksByPrice: new TreeMap([], { comparator: (a, b) => a - b }),
        buffered: [],
        needsResync: false,
    };
}

export function installBookSnapshot(
    state: LocalOrderBookState,
    snapshot: BookSnapshot,
): boolean {
    state.assetId = snapshot.assetId;
    state.epoch = snapshot.epoch;
    state.seqId = snapshot.seqId;
    state.ts = snapshot.ts;
    state.orders.clear();
    state.bidsByPrice.clear();
    state.asksByPrice.clear();
    state.needsResync = false;

    for (const level of snapshot.bids) addSnapshotOrders(state, level.orders, "buy");
    for (const level of snapshot.asks) addSnapshotOrders(state, level.orders, "sell");

    const buffered = state.buffered
        .filter((update) => update.assetId === snapshot.assetId && update.epoch === snapshot.epoch)
        .filter((update) => update.seqId > snapshot.seqId)
        .sort((a, b) => (a.seqId < b.seqId ? -1 : a.seqId > b.seqId ? 1 : 0));
    state.buffered = [];

    for (const update of buffered) {
        const result = applyMarketUpdate(state, update);
        if (result === "buffered" || result === "invalid") return false;
    }

    return true;
}

export function applyMarketUpdate(
    state: LocalOrderBookState,
    update: WebSocketMarketUpdate,
): MarketApplyResult {
    if (update.assetId !== state.assetId) return "ignored";
    if (state.epoch != null && update.epoch !== state.epoch) return "ignored-epoch";

    if (state.seqId == null || state.needsResync) {
        state.buffered.push(update);
        state.needsResync = true;
        return "buffered";
    }

    // TODO: need to update backend to not reset seqId due to restart
    //if (update.seqId <= state.seqId) return "duplicate";
    if (update.seqId <= state.seqId) {
        state.buffered.push(update);
        state.needsResync = true;
        return "buffered";
    }

    if (update.seqId !== state.seqId + 1n) {
        state.buffered.push(update);
        state.needsResync = true;
        return "buffered";
    }

    if (!applyPayload(state, update)) {
        state.buffered.push(update);
        state.needsResync = true;
        return "invalid";
    }

    state.seqId = update.seqId;
    state.ts = BigInt(Date.now());
    return "applied";
}

export function buildBookSnapshot(state: LocalOrderBookState): BookSnapshot {
    return {
        assetId: state.assetId,
        epoch: state.epoch ?? 0n,
        seqId: state.seqId ?? 0n,
        ts: state.ts,
        bids: levelSnapshots(state.bidsByPrice),
        asks: levelSnapshots(state.asksByPrice),
    };
}

function addSnapshotOrders(
    state: LocalOrderBookState,
    orders: PendingOrder[],
    side: Side,
): void {
    for (const order of orders) {
        const normalized = { ...order, side };
        state.orders.set(normalized.id, normalized);
        addOrderToLevel(state, normalized);
    }
}

function applyPayload(
    state: LocalOrderBookState,
    update: WebSocketMarketUpdate,
): boolean {
    if (update.type === "order") return applyOrder(state, update);
    if (update.type === "trade") return applyTrade(state, update);
    if (update.type === "cancel") return applyCancel(state, update);

    if (update.type === "resolution") {
        state.orders.clear();
        state.bidsByPrice.clear();
        state.asksByPrice.clear();
        return true;
    }

    return false;
}

function applyOrder(
    state: LocalOrderBookState,
    update: WebSocketOrderUpdate,
): boolean {
    const side = normalizeSide(update.data.side);
    if (!side) return false;

    const order: PendingOrder = {
        id: update.data.orderId,
        side,
        price: Number(update.data.price),
        size: Number(update.data.size),
        time: Number(update.data.arrivalTime),
        account: "",
        epoch: update.data.epoch,
    };

    const previous = state.orders.get(order.id);
    if (previous) removeOrderFromLevel(state, previous);

    state.orders.set(order.id, order);
    addOrderToLevel(state, order);
    return true;
}

function applyTrade(
    state: LocalOrderBookState,
    update: WebSocketTradeUpdate,
): boolean {
    const current = state.orders.get(update.data.orderId);
    if (!current) return false;

    const fill = Number(update.data.fill);
    if (!Number.isFinite(fill) || fill <= 0) return false;

    const remaining = current.size - fill;
    removeOrderFromLevel(state, current);
    state.orders.delete(current.id);

    if (remaining > 0) {
        const updated = { ...current, size: remaining };
        state.orders.set(updated.id, updated);
        addOrderToLevel(state, updated);
    }

    return true;
}

function applyCancel(
    state: LocalOrderBookState,
    update: WebSocketCancelUpdate,
): boolean {
    const orderId = update.data.cancelId;
    const order = state.orders.get(orderId);
    if (!order) return false;

    removeOrderFromLevel(state, order);
    state.orders.delete(order.id);
    return true;
}

function addOrderToLevel(
    state: LocalOrderBookState,
    order: PendingOrder,
): void {
    const levels = order.side === "buy"
        ? state.bidsByPrice
        : state.asksByPrice;

    let level = levels.get(order.price);
    if (!level) {
        level = createPriceLevel(order.price);
        levels.set(order.price, level);
    }

    level.orders.set(order.id, order);
    level.size += order.size;
    refreshPriceLevel(level);
}

function removeOrderFromLevel(
    state: LocalOrderBookState,
    order: PendingOrder,
): void {
    const levels = order.side === "buy"
        ? state.bidsByPrice
        : state.asksByPrice;
    const level = levels.get(order.price);
    if (!level) return;

    if (!level.orders.delete(order.id)) return;
    level.size -= order.size;

    if (level.orders.size === 0) levels.delete(order.price);
    else refreshPriceLevel(level);
}

function createPriceLevel(price: number): MutablePriceLevel {
    const level: MutablePriceLevel = {
        price,
        size: 0,
        orders: new Map(),
        snapshot: {
            price,
            size: 0,
            orderCount: 0,
            orders: [],
        },
    };
    return level;
}

function refreshPriceLevel(level: MutablePriceLevel): void {
    level.snapshot = {
        price: level.price,
        size: level.size,
        orderCount: level.orders.size,
        orders: Array.from(level.orders.values()),
    };
}

function levelSnapshots(
    levels: TreeMap<number, MutablePriceLevel>,
): BookLevel[] {
    const snapshots: BookLevel[] = [];
    for (const level of levels.values()) {
        if (level) snapshots.push(level.snapshot);
    }
    return snapshots;
}

function normalizeSide(value: string): Side | null {
    const side = value.toLowerCase();
    if (side === "buy" || side === "bid") return "buy";
    if (side === "sell" || side === "ask") return "sell";
    return null;
}
