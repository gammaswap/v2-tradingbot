import { describe, expect, it } from "vitest";
import { NonceManager } from "@gammaswap/v2-exchange-sdk";
import {
  InMemoryOrderIntentStore,
  OrderIntentManager,
  makeOrderIntentId,
} from "../src/runtime/orderIntent.js";

const input = {
  kind: "place" as const,
  assetId: "1",
  epoch: 4n,
  slot: "buy-0",
  side: "buy" as const,
  price: 400_000,
  size: 1_000_000,
};

describe("order intent idempotency", () => {
  it("reuses the same nonce for the same signed intent", () => {
    const manager = new OrderIntentManager(
      new InMemoryOrderIntentStore(),
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );

    const first = manager.getOrCreate(input);
    const second = manager.getOrCreate({ ...input });

    expect(second.intentId).toBe(first.intentId);
    expect(second.nonce).toBe(first.nonce);
  });

  it("creates a different identity when a signed field changes", () => {
    expect(makeOrderIntentId(input)).not.toBe(makeOrderIntentId({ ...input, price: 401_000 }));
    expect(makeOrderIntentId(input)).not.toBe(makeOrderIntentId({ ...input, epoch: 5n }));
    expect(makeOrderIntentId(input)).not.toBe(makeOrderIntentId({ ...input, side: "sell" }));
  });

  it("tracks ambiguous submissions for retry with the same nonce", () => {
    const manager = new OrderIntentManager(
      new InMemoryOrderIntentStore(),
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );
    const intent = manager.getOrCreate(input);

    manager.markAttempted(intent);
    manager.markUnknown(intent);
    const retry = manager.getOrCreate(input);

    expect(retry.status).toBe("unknown");
    expect(retry.nonce).toBe(intent.nonce);
    expect(retry.attempts).toBe(1);
  });

  it("allocates a second nonce for cancel-replace", () => {
    const manager = new OrderIntentManager(
      new InMemoryOrderIntentStore(),
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );
    const intent = manager.getOrCreate({
      kind: "cancel-replace",
      assetId: input.assetId,
      epoch: input.epoch,
      slot: "replace-buy-0",
      targetOrderHash: "0xold",
      side: input.side,
      price: input.price,
      size: input.size,
    });

    expect(intent.replacementNonce).toBeDefined();
    expect(intent.replacementNonce).not.toBe(intent.nonce);
  });

  it("allocates a fresh nonce after the prior intent is completed", () => {
    const manager = new OrderIntentManager(
      new InMemoryOrderIntentStore(),
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );
    const first = manager.getOrCreate(input);
    manager.markAccepted(first, "0xorder");
    manager.markCompleted(first);

    const next = manager.getOrCreate(input);
    expect(next.nonce).not.toBe(first.nonce);
    expect(next.status).toBe("reserved");
  });

  it("uses a distinct identity and nonce for cancellation", () => {
    const manager = new OrderIntentManager(
      new InMemoryOrderIntentStore(),
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );
    const place = manager.getOrCreate(input);
    const cancel = manager.getOrCreate({
      kind: "cancel",
      assetId: input.assetId,
      epoch: input.epoch,
      slot: "cancel-0xorder",
      targetOrderHash: "0xorder",
    });

    expect(cancel.intentId).not.toBe(place.intentId);
    expect(cancel.nonce).not.toBe(place.nonce);
    expect(manager.getOutstanding("cancel")).toHaveLength(1);
  });
});
