import { CFG } from "../config/config.js";
import type { Asset } from "../utils/types.js";
import { clamp, nowMs } from "../utils/utils.js";
import { STATE } from "./state.js";

const PROTOCOL_PRICE_SCALE = 1_000_000;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export type FairValueEstimate = {
    protocolPrice: number;
    probability: number;
    spot: bigint;
    strike: bigint;
    expiresInSec: number;
    updatedAtMs: number;
};

export function computeFairValueEstimate(spot: bigint, asset: Asset, timestampMs = nowMs()): FairValueEstimate | null {
    if (spot <= 0n || asset.strikePrice <= 0n) return null;

    const spotNumber = Number(spot);
    const strikeNumber = Number(asset.strikePrice);
    if (!Number.isFinite(spotNumber) || !Number.isFinite(strikeNumber) || strikeNumber <= 0) return null;

    const nowSec = Math.floor(timestampMs / 1000);
    const expiresInSec = Math.max(0, Number(asset.expiration) - nowSec);
    let probability = probabilityAboveStrike(spotNumber, strikeNumber, expiresInSec);
    if (!CFG.FAIR_VALUE_PAYS_ABOVE_STRIKE) probability = 1 - probability;
    probability = clamp(probability, 0, 1);

    const protocolPrice = roundToProtocolTick(probability * PROTOCOL_PRICE_SCALE);
    return {
        protocolPrice,
        probability,
        spot,
        strike: asset.strikePrice,
        expiresInSec,
        updatedAtMs: timestampMs,
    };
}

export function updateFairValueFromOracle(spot: bigint, oracleTs: bigint | null = null): FairValueEstimate | null {
    STATE.oracle.price = spot;
    STATE.oracle.ts = oracleTs;
    STATE.oracle.receivedAtMs = nowMs();
    STATE.oracle.stale = false;

    if (!STATE.asset) {
        STATE.fairValue = null;
        return null;
    }

    const estimate = computeFairValueEstimate(spot, STATE.asset, STATE.oracle.receivedAtMs);
    STATE.fairValue = estimate;
    return estimate;
}

export function markFairValueStale() {
    STATE.oracle.stale = true;
    STATE.fairValue = null;
}

function probabilityAboveStrike(spot: number, strike: number, expiresInSec: number): number {
    if (expiresInSec <= 0 || CFG.FAIR_VALUE_VOL <= 0) {
        return spot >= strike ? 1 : 0;
    }

    const timeYears = expiresInSec / SECONDS_PER_YEAR;
    const vol = CFG.FAIR_VALUE_VOL;
    const denominator = vol * Math.sqrt(timeYears);
    if (denominator <= 0) return spot >= strike ? 1 : 0;

    const d2 = (Math.log(spot / strike) - 0.5 * vol * vol * timeYears) / denominator;
    return normalCdf(d2);
}

function roundToProtocolTick(value: number): number {
    const tick = CFG.TICK_SIZE;
    if (tick <= 0) return Math.round(value);
    return clamp(Math.round(value / tick) * tick, 0, PROTOCOL_PRICE_SCALE);
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
}
