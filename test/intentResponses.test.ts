import { describe, expect, it } from "vitest";
import { ORDER_INTENTS } from "../src/runtime/orderIntent.js";
import {
  handleCancelReplaceResponse,
  handleCancelResponse,
  handlePlaceOrderResponse,
} from "../src/runtime/intentResponses.js";

function place(slot: string) {
  return ORDER_INTENTS.getOrCreate({
    kind: "place",
    assetId: "response-test",
    epoch: 1n,
    slot,
    side: "buy",
    price: 400_000,
    size: 1_000_000,
  });
}

describe("intent response handling", () => {
  it("completes accepted new-order submissions without requiring a fill", () => {
    const intent = place("accepted");

    handlePlaceOrderResponse(intent, {
      request: { orderHash: "0xaccepted" },
      data: { status: "ACCEPTED" },
    });

    expect(intent.status).toBe("completed");
    expect(intent.outcome).toBe("order-accepted");
  });

  it("completes cancellations when the target is already gone", () => {
    const intent = ORDER_INTENTS.getOrCreate({
      kind: "cancel",
      assetId: "response-test",
      epoch: 1n,
      slot: "cancel-failed",
      targetOrderHash: "0xcancel-failed",
    });

    handleCancelResponse(intent, { data: { status: "CANCEL_FAILED" } });

    expect(intent.status).toBe("completed");
    expect(intent.outcome).toBe("cancel-already-completed");
  });

  it("completes a successful cancel-replace", () => {
    const intent = ORDER_INTENTS.getOrCreate({
      kind: "cancel-replace",
      assetId: "response-test",
      epoch: 1n,
      slot: "replace-success",
      targetOrderHash: "0xold",
      side: "sell",
      price: 600_000,
      size: 1_000_000,
    });

    handleCancelReplaceResponse(intent, {
      request: { orderHash: "0xreplace" },
      data: { status: "SUCCESS" },
    });

    expect(intent.status).toBe("completed");
    expect(intent.outcome).toBe("cancel-replace-succeeded");
  });

  it("records a committed cancel when the replacement fails", () => {
    const intent = ORDER_INTENTS.getOrCreate({
      kind: "cancel-replace",
      assetId: "response-test",
      epoch: 1n,
      slot: "replace-failed",
      targetOrderHash: "0xold-2",
      side: "sell",
      price: 600_000,
      size: 1_000_000,
    });

    handleCancelReplaceResponse(intent, {
      data: { status: "CANCEL_COMMITTED_REPLACEMENT_FAILED" },
    });

    expect(intent.status).toBe("completed");
    expect(intent.outcome).toBe("cancel-succeeded-replacement-failed");
  });
});
