import crypto from "crypto";
import { CFG, type Side } from "../config/config.js";

export function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export function nowMs() {
    return Date.now();
}

export function clamp(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
}

export function roundToTick(price: number, side: Side): number {
    const t = CFG.TICK_SIZE;
    if (t <= 0) return price;
    const q = price / t;
    const r = side === "buy" ? Math.floor(q) : Math.ceil(q);
    return Math.floor(r * t);
}

export function roundToLot(lot: number): number {
    const t = CFG.LOT_SIZE;
    if (t <= 0) return lot;
    const q = lot / t;
    const r = Math.ceil(q);
    return Math.floor(r * t);
}

export function jitter(baseMs: number, jitterMs: number) {
    const j = (Math.random() * 2 - 1) * jitterMs;
    return Math.max(50, Math.floor(baseMs + j));
}

export function randBetween(a: number, b: number) {
    return a + Math.random() * (b - a);
}

export function tanh(x: number) {
    return Math.tanh(x);
}

export function idempotencyKey(prefix: string) {
    return `${prefix}-${crypto.randomUUID()}`;
}

export function log(...args: any[]) {
    if (CFG.LOG_VERBOSE) console.log(new Date().toISOString(), ...args);
}

export function warn(...args: any[]) {
    console.warn(new Date().toISOString(), ...args);
}

export function isBigIntString(value: string): boolean {
    if (typeof value !== "string") return false;

    // Must match:
    // - "0"
    // - or non-zero digit followed by digits
    const regex = /^(0|[1-9]\d*)$/;

    return regex.test(value);
}
