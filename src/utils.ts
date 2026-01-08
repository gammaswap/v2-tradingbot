import crypto from "crypto";
import { CFG, type Side } from "./config.js";

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
    return r * t;
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
