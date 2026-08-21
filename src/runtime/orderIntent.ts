import { NonceManager, TimeInForce } from "@gammaswap/v2-exchange-sdk";

export type IntentStatus =
    | "reserved" | "attempted" | "accepted" | "unknown"
    | "rejected" | "completed" | "unfulfillable";

type IntentBase = { assetId: string; epoch: bigint; slot: string };

export type PlaceOrderIntentInput = IntentBase & {
    kind: "place"; side: "buy" | "sell"; price: number; size: number;
    timeInForce?: 0n | 1n | 2n;
};

export type CancelOrderIntentInput = IntentBase & {
    kind: "cancel"; targetOrderHash: string;
};

export type CancelReplaceIntentInput = IntentBase & {
    kind: "cancel-replace"; targetOrderHash: string; side: "buy" | "sell";
    price: number; size: number; timeInForce?: 0n | 1n | 2n;
};

export type OrderIntentInput =
    | PlaceOrderIntentInput
    | CancelOrderIntentInput
    | CancelReplaceIntentInput;

export type TrackedOrderIntent = OrderIntentInput & {
    intentId: string; nonce: bigint; status: IntentStatus;
    attempts: number; lastAttemptAt: number | null; requestHash: string | null;
    replacementNonce?: bigint;
};

export type OrderIntentStore = {
    get(intentId: string): TrackedOrderIntent | undefined;
    set(intent: TrackedOrderIntent): void;
    all(): TrackedOrderIntent[];
};

export class InMemoryOrderIntentStore implements OrderIntentStore {
    private readonly intents = new Map<string, TrackedOrderIntent>();

    get(intentId: string): TrackedOrderIntent | undefined { return this.intents.get(intentId); }
    set(intent: TrackedOrderIntent): void { this.intents.set(intent.intentId, intent); }
    all(): TrackedOrderIntent[] { return [...this.intents.values()]; }
}

export class OrderIntentManager {
    constructor(
        private readonly store: OrderIntentStore = new InMemoryOrderIntentStore(),
        private readonly nonceManager = new NonceManager(),
    ) {}

    getOrCreate(input: OrderIntentInput): TrackedOrderIntent {
        const normalized = normalizeIntentInput(input);
        const intentId = makeOrderIntentId(normalized);
        const existing = this.store.get(intentId);
        if (existing && !["completed", "rejected", "unfulfillable"].includes(existing.status)) return existing;

        const intent = {
            ...normalized,
            intentId,
            nonce: this.nonceManager.next(),
            status: "reserved" as const,
            attempts: 0,
            lastAttemptAt: null,
            requestHash: null,
            replacementNonce: normalized.kind === "cancel-replace" ? this.nonceManager.next() : undefined,
        } as TrackedOrderIntent;
        this.store.set(intent);
        return intent;
    }

    getOutstanding(kind?: TrackedOrderIntent["kind"]): TrackedOrderIntent[] {
        return this.store.all().filter((intent) =>
            (kind == null || intent.kind === kind) &&
            !["completed", "rejected", "unfulfillable"].includes(intent.status),
        );
    }

    markAttempted(intent: TrackedOrderIntent): void {
        intent.status = "attempted";
        intent.attempts += 1;
        intent.lastAttemptAt = Date.now();
        this.store.set(intent);
    }

    markAccepted(intent: TrackedOrderIntent, requestHash: string | null = null): void {
        intent.status = "accepted";
        intent.requestHash = requestHash;
        this.store.set(intent);
    }

    markUnknown(intent: TrackedOrderIntent): void { intent.status = "unknown"; this.store.set(intent); }
    markCompleted(intent: TrackedOrderIntent): void { intent.status = "completed"; this.store.set(intent); }
    markUnfulfillable(intent: TrackedOrderIntent): void { intent.status = "unfulfillable"; this.store.set(intent); }
}

function normalizeIntentInput(input: OrderIntentInput): OrderIntentInput {
    if (input.kind === "cancel") return input;
    return { ...input, timeInForce: input.timeInForce ?? TimeInForce.GTC };
}

export function makeOrderIntentId(input: OrderIntentInput): string {
    switch (input.kind) {
        case "place":
            return [input.kind, input.assetId, input.epoch.toString(), input.slot, input.side,
                input.price, input.size, (input.timeInForce ?? TimeInForce.GTC).toString()].join(":");
        case "cancel":
            return [input.kind, input.assetId, input.epoch.toString(), input.targetOrderHash].join(":");
        case "cancel-replace":
            return [input.kind, input.assetId, input.epoch.toString(), input.slot, input.targetOrderHash,
                input.side, input.price, input.size, (input.timeInForce ?? TimeInForce.GTC).toString()].join(":");
    }
}

export const ORDER_INTENTS = new OrderIntentManager();
