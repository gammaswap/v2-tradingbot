import {
    ORDER_INTENTS,
    type TrackedOrderIntent,
    type IntentOutcome,
} from "./orderIntent.js";
import { QUOTE_COOLDOWNS } from "./quoteCooldown.js";

type ApiResponse = {
    request?: { orderHash?: string };
    data?: any;
};

function requestHash(response: ApiResponse): string | null {
    return response.request?.orderHash ?? null;
}

function startQuoteCooldown(intent: TrackedOrderIntent, reason: string): void {
    QUOTE_COOLDOWNS.start({
        assetId: intent.assetId,
        epoch: intent.epoch,
        quoteSlot: intent.slot,
    }, reason);
}

export function handlePlaceOrderResponse(intent: TrackedOrderIntent, response: ApiResponse): void {
    const status = response.data?.status;
    const outcomes: Record<string, IntentOutcome> = {
        ACCEPTED: "order-accepted",
        FILLED: "order-filled",
        PARTIALLY_FILLED: "order-partially-filled",
        CANCELLED: "order-cancelled",
        REJECTED: "order-rejected",
    };
    const outcome = outcomes[status];
    if (outcome != null) {
        ORDER_INTENTS.markCompleted(intent, outcome, requestHash(response));
        if (outcome === "order-rejected") {
            startQuoteCooldown(intent, `new order rejected: ${response.data?.reason ?? "unknown"}`);
        }
    } else {
        ORDER_INTENTS.markUnknown(intent, requestHash(response));
    }
}

export function handleCancelResponse(intent: TrackedOrderIntent, response: ApiResponse): void {
    const status = response.data?.status;
    if (status === "CANCELLED") {
        ORDER_INTENTS.markCompleted(intent, "cancel-succeeded", requestHash(response));
    } else if (status === "CANCEL_FAILED") {
        // The target order is already gone, so the cancellation goal is
        // complete even though this request did not cancel it.
        ORDER_INTENTS.markCompleted(intent, "cancel-already-completed", requestHash(response));
    } else if (status === "CANCEL_NOT_COMMITTED") {
        ORDER_INTENTS.markCompleted(intent, "cancel-not-committed", requestHash(response));
    } else {
        // The target may still be pending, so retain the intent for a
        // backoff-controlled retry and pending-order verification.
        ORDER_INTENTS.markUnknown(intent, requestHash(response));
    }
}

export function handleCancelReplaceResponse(intent: TrackedOrderIntent, response: ApiResponse): void {
    const data = response.data ?? {};
    const status = data.status;
    const cancelStatus = data.cancel?.status;
    const hash = requestHash(response);

    if (status === "SUCCESS") {
        ORDER_INTENTS.markCompleted(intent, "cancel-replace-succeeded", hash);
    } else if (status === "CANCEL_FAILED") {
        ORDER_INTENTS.markCompleted(intent, "cancel-already-completed", hash);
    } else if (status === "CANCEL_NOT_COMMITTED") {
        ORDER_INTENTS.markCompleted(intent, "cancel-not-committed", hash);
    } else if (
        status === "CANCEL_COMMITTED_REPLACEMENT_FAILED" ||
        (status === "REPLACEMENT_FAILED" && cancelStatus === "CANCELLED")
    ) {
        // The old order is gone; the next quote pass can create a new
        // replacement intent using the current desired price and size.
        ORDER_INTENTS.markCompleted(intent, "cancel-succeeded-replacement-failed", hash);
        startQuoteCooldown(intent, `replacement failed: ${data.replacement?.reason ?? data.reason ?? "unknown"}`);
    } else if (status === "REPLACEMENT_FAILED") {
        ORDER_INTENTS.markCompleted(intent, "replacement-failed", hash);
        startQuoteCooldown(intent, `replacement failed: ${data.replacement?.reason ?? data.reason ?? "unknown"}`);
    } else {
        ORDER_INTENTS.markUnknown(intent, hash);
    }
}
