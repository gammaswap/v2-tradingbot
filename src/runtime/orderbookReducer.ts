import type { WebSocketMarketUpdate } from "@gammaswap/v2-exchange-sdk";
import type { Side } from "../config/config.js";
import type { BookLevel, BookSnapshot, PendingOrder } from "../utils/types.js";

export type LocalBookOrder = PendingOrder;

export type LocalOrderBookState = {
    assetId: bigint;
    epoch: bigint | null;
    seqId: bigint | null;
    ts: bigint;
    orders: Map<string, LocalBookOrder>;
    buffered: WebSocketMarketUpdate[];
    needsResync: boolean;
};

export type MarketApplyResult = "applied" | "duplicate" | "ignored" | "ignored-epoch" | "buffered" | "invalid";

export function createLocalOrderBookState(assetId: bigint): LocalOrderBookState {
    return {
        assetId,
        epoch: null,
        seqId: null,
        ts: 0n,
        orders: new Map(),
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

    if (update.seqId <= state.seqId) return "duplicate";

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
    const bids = new Map<number, PendingOrder[]>();
    const asks = new Map<number, PendingOrder[]>();

    for (const order of state.orders.values()) {
        const levels = order.side === "buy" ? bids : asks;
        const orders = levels.get(order.price) ?? [];
        orders.push(order);
        levels.set(order.price, orders);
    }

    return {
        assetId: state.assetId,
        epoch: state.epoch ?? 0n,
        seqId: state.seqId ?? 0n,
        ts: state.ts,
        bids: buildLevels(bids, "buy"),
        asks: buildLevels(asks, "sell"),
    };
}

function addSnapshotOrders(
    state: LocalOrderBookState,
    orders: PendingOrder[],
    side: Side,
): void {
    for (const order of orders) {
        state.orders.set(order.id, { ...order, side });
    }
}

function applyPayload(
    state: LocalOrderBookState,
    update: WebSocketMarketUpdate,
): boolean {
    if (update.type === "order") {
        const side = normalizeSide(update.data.side);
        if (!side) return false;

        state.orders.set(update.data.orderId, {
            id: update.data.orderId,
            side,
            price: Number(update.data.price),
            size: Number(update.data.size),
            time: Number(update.data.arrivalTime),
            account: "",
            epoch: update.data.epoch,
        });
        return true;
    }

    if (update.type === "trade") {
        const order = state.orders.get(update.data.orderId);
        if (!order) return false;

        const remaining = order.size - Number(update.data.fill);
        if (remaining <= 0) state.orders.delete(order.id);
        else state.orders.set(order.id, { ...order, size: remaining });
        return true;
    }

    if (update.type === "cancel") {
        const orderId = update.data.cancelId || update.data.orderId;
        return state.orders.delete(orderId);
    }

    if (update.type === "resolution") {
        state.orders.clear();
        return true;
    }

    return false;
}

function normalizeSide(value: string): Side | null {
    const side = value.toLowerCase();
    if (side === "buy" || side === "bid") return "buy";
    if (side === "sell" || side === "ask") return "sell";
    return null;
}

function buildLevels(
    grouped: Map<number, PendingOrder[]>,
    side: Side,
): BookLevel[] {
    return Array.from(grouped.entries())
        .sort(([a], [b]) => side === "buy" ? b - a : a - b)
        .map(([price, orders]) => ({
            price,
            size: orders.reduce((total, order) => total + order.size, 0),
            orderCount: orders.length,
            orders,
        }));
}
