import crypto from "crypto";
import { CFG, type Side } from "./config.js";
import { idempotencyKey } from "./utils.js";
import type { ApiBookResponse, ApiPendingResponse } from "./types.js";

function buildHeaders(body?: any): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (CFG.API_KEY) h["X-API-KEY"] = CFG.API_KEY;

    // Placeholder signature scheme — replace with your real scheme if needed
    if (CFG.API_SECRET && body != null) {
        const payload = JSON.stringify(body);
        const sig = crypto.createHmac("sha256", CFG.API_SECRET).update(payload).digest("hex");
        h["X-SIGNATURE"] = sig;
    }
    return h;
}

async function httpGetJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { method: "GET", headers: buildHeaders() });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

async function httpPostJson<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: buildHeaders(body), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

/*export async function apiGetBook(): Promise<ApiBookResponse> {
    return httpGetJson<ApiBookResponse>(CFG.BOOK_URL);
}/**/
export async function apiGetBook(): Promise<any> {
    return httpGetJson<any>(CFG.BOOK_URL);
}

/*export async function apiGetPending(): Promise<ApiPendingResponse> {
    return httpGetJson<ApiPendingResponse>(CFG.PENDING_URL);
}/**/
export async function apiGetPending(): Promise<any> {
    return httpGetJson<any>(CFG.PENDING_URL);
}

export async function apiSendOrder(order: { side: Side; price: number; size: number }) {
    // Generic payload — adjust to match your API schema
    const payload = {
        user: CFG.USER_ADDRESS,
        side: order.side,
        price: order.price,
        size: order.size,
        clientId: idempotencyKey("order"),
    };
    return httpPostJson<any>(CFG.ORDERS_URL, payload);
}

export async function apiCancelOrder(orderId: string) {
    const payload = {
        user: CFG.USER_ADDRESS,
        orderId,
        clientId: idempotencyKey("cancel"),
    };
    return httpPostJson<any>(CFG.CANCELS_URL, payload);
}
