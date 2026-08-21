import { describe, expect, it } from "vitest";
import {
    applyMarketUpdate,
    buildBookSnapshot,
    createLocalOrderBookState,
    installBookSnapshot,
} from "../src/runtime/orderbookReducer.js";

function snapshot() {
    return {
        assetId: 1n,
        epoch: 2n,
        seqId: 10n,
        ts: 100n,
        bids: [],
        asks: [],
    };
}

function orderUpdate(seqId: bigint, overrides: Record<string, unknown> = {}) {
    return {
        type: "order",
        assetId: 1n,
        epoch: 2n,
        seqId,
        data: {
            orderId: "order-1",
            side: "buy",
            price: "400000",
            size: "1000000",
            arrivalTime: "1",
            epoch: 2n,
            ...overrides,
        },
    } as any;
}

describe("local order book reducer", () => {
    it("buffers updates until a snapshot establishes a sequence", () => {
        const state = createLocalOrderBookState(1n);

        expect(applyMarketUpdate(state, orderUpdate(11n))).toBe("buffered");
        expect(state.needsResync).toBe(true);
        expect(state.buffered).toHaveLength(1);
    });

    it("applies sequential orders and maintains book levels", () => {
        const state = createLocalOrderBookState(1n);
        installBookSnapshot(state, snapshot());

        const update = orderUpdate(11n);
        expect(applyMarketUpdate(state, update)).toBe("applied");

        const book = buildBookSnapshot(state);
        expect(book.bids[0]?.price).toBe(400_000);
        expect(book.bids[0]?.size).toBe(1_000_000);
    });

    it("ignores updates for another asset or epoch", () => {
        const state = createLocalOrderBookState(1n);
        installBookSnapshot(state, snapshot());

        expect(applyMarketUpdate(state, { ...orderUpdate(11n), assetId: 2n })).toBe("ignored");
        expect(applyMarketUpdate(state, { ...orderUpdate(11n), epoch: 3n })).toBe("ignored-epoch");
    });

    it("requests resync on sequence gaps", () => {
        const state = createLocalOrderBookState(1n);
        installBookSnapshot(state, snapshot());

        expect(applyMarketUpdate(state, orderUpdate(12n))).toBe("buffered");
        expect(state.needsResync).toBe(true);
    });

    it("replays buffered events after installing a matching snapshot", () => {
        const state = createLocalOrderBookState(1n);
        expect(applyMarketUpdate(state, orderUpdate(11n))).toBe("buffered");

        expect(installBookSnapshot(state, snapshot())).toBe(true);
        expect(buildBookSnapshot(state).bids[0]?.price).toBe(400_000);
    });

    it("clears the book on resolution", () => {
        const state = createLocalOrderBookState(1n);
        installBookSnapshot(state, snapshot());
        applyMarketUpdate(state, orderUpdate(11n));

        const resolution = {
            type: "resolution",
            assetId: 1n,
            epoch: 2n,
            seqId: 12n,
            data: {},
        } as any;

        expect(applyMarketUpdate(state, resolution)).toBe("applied");
        expect(buildBookSnapshot(state).bids).toEqual([]);
    });
});
