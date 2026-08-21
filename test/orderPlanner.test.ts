import { describe, expect, it } from "vitest";
import { planOrders } from "../src/runtime/orderPlanner.js";
import type { PendingOrder } from "../src/utils/types.js";

function order(id: string, side: "buy" | "sell", price = 400_000): PendingOrder {
    return {
        id,
        side,
        price,
        size: 1_000_000,
        time: 1,
        account: "0xaccount",
        epoch: 1n,
    };
}

describe("order planning", () => {
    it("creates new orders when no orders exist", () => {
        const result = planOrders([], [400_000, 450_000], [1_000_000, 1_000_000], 1, "buy", 10_000_000);

        expect(result.newOrders).toHaveLength(2);
        expect(result.newOrders.every((item) => item.side === "buy")).toBe(true);
    });

    it("cancels excess existing orders", () => {
        const result = planOrders(
            [order("one", "buy"), order("two", "buy")],
            [400_000],
            [1_000_000],
            1,
            "buy",
            10_000_000,
        );

        expect(result.cancels).toEqual(["two"]);
    });

    it("creates a cancel-replace when the target materially changes", () => {
        const result = planOrders(
            [order("one", "buy", 400_000)],
            [500_000],
            [1_000_000],
            1,
            "buy",
            10_000_000,
        );

        expect(result.cancelReplaces).toEqual([{
            price: 500_000,
            size: 1_000_000,
            side: "buy",
            cancelId: "one",
            quoteSlot: "buy-0",
        }]);
    });

    it("uses sell-side margin when adding sell orders", () => {
        const result = planOrders([], [800_000], [1_000_000], 1, "sell", 300_000);

        expect(result.newOrders).toEqual([{
            price: 800_000,
            size: 1_000_000,
            side: "sell",
            quoteSlot: "sell-0",
        }]);
    });

    it("rounds planned sizes to lot size", () => {
        const result = planOrders([], [400_000], [1_234_567], 1, "buy", 10_000_000);

        expect(result.newOrders[0]?.size).toBe(1_240_000);
    });
});
