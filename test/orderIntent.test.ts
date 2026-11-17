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
    const store = new InMemoryOrderIntentStore();
    const manager = new OrderIntentManager(
      store,
      new NonceManager({ initialTimestampMs: 1_700_000_000_000n, now: () => 1_700_000_000_000 }),
    );
    const first = manager.getOrCreate(input);
    manager.markAccepted(first, "0xorder");
    manager.markCompleted(first);

    expect(store.get(first.intentId)).toBeUndefined();
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

describe("order intent retention", () => {
  it.each(["completed", "rejected", "unfulfillable"] as const)(
    "removes %s intents from the store",
    (status) => {
      const store = new InMemoryOrderIntentStore();
      const manager = new OrderIntentManager(store);
      const intent = manager.getOrCreate(input);

      store.set({ ...intent, status });

      expect(store.get(intent.intentId)).toBeUndefined();
      expect(store.all()).toEqual([]);
    },
  );

  it.each(["reserved", "attempted", "accepted", "unknown"] as const)(
    "preserves a %s intent and its nonce while other intents complete",
    (status) => {
      const store = new InMemoryOrderIntentStore();
      const manager = new OrderIntentManager(store);
      const intent = manager.getOrCreate(input);
      if (status === "attempted" || status === "unknown") manager.markAttempted(intent);
      if (status === "accepted") manager.markAccepted(intent, "0xorder");
      if (status === "unknown") manager.markUnknown(intent);
      const nonce = intent.nonce;

      for (let i = 0; i < 1_000; i++) {
        const completed = manager.getOrCreate({ ...input, slot: `completed-${i}` });
        manager.markCompleted(completed);
      }

      expect(store.all()).toEqual([intent]);
      expect(manager.getOutstanding()).toEqual([intent]);
      const retry = manager.getOrCreate(input);
      expect(retry).toBe(intent);
      expect(retry.status).toBe(status);
      expect(retry.nonce).toBe(nonce);
    },
  );
});
