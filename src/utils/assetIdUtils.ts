import { DecodedAssetId } from "./types.js";

const ID_BITS = 64;
const TYPE_BITS = 8;
const START_BITS = 32;
const PERIOD_BITS = 32;
const STRIKE_BITS = 48;
const RANGE_BITS = 16;
const RESERVED_BITS = 56;

const ID_OFFSET = 0;
const TYPE_OFFSET = ID_OFFSET + ID_BITS;           // 64
const START_OFFSET = TYPE_OFFSET + TYPE_BITS;      // 72
const PERIOD_OFFSET = START_OFFSET + START_BITS;   // 104
const STRIKE_OFFSET = PERIOD_OFFSET + PERIOD_BITS; // 136
const RANGE_OFFSET = STRIKE_OFFSET + STRIKE_BITS;  // 184
const RESERVED_OFFSET = RANGE_OFFSET + RANGE_BITS; // 200

const ID_MASK = (1n << BigInt(ID_BITS)) - 1n;
const TYPE_MASK = (1n << BigInt(TYPE_BITS)) - 1n;
const START_MASK = (1n << BigInt(START_BITS)) - 1n;
const PERIOD_MASK = (1n << BigInt(PERIOD_BITS)) - 1n;
const STRIKE_MASK = (1n << BigInt(STRIKE_BITS)) - 1n;
const RANGE_MASK = (1n << BigInt(RANGE_BITS)) - 1n;
const RESERVED_MASK = (1n << BigInt(RESERVED_BITS)) - 1n;

const ID_MAX = (1n << BigInt(ID_BITS)) - 1n;
const TYPE_MAX = (1n << BigInt(TYPE_BITS)) - 1n;
const START_MAX = (1n << BigInt(START_BITS)) - 1n;
const PERIOD_MAX = (1n << BigInt(PERIOD_BITS)) - 1n;
const STRIKE_MAX = (1n << BigInt(STRIKE_BITS)) - 1n;
const RANGE_MAX = (1n << BigInt(RANGE_BITS)) - 1n;
const RESERVED_MAX = (1n << BigInt(RESERVED_BITS)) - 1n;

/** Returns the oracle symbol identifier encoded in the asset ID's low bits. */
export function getSymbolIdFromAssetId(assetId: bigint): string {
    return (assetId & ID_MASK).toString();
}

/**
 * Encode assetId from components (matches PackedAssetId.pack).
 */
export function encodeAssetId(
    id: bigint | number,
    marketType: number,
    startTime: number,
    periodLength: number,
    strike: string,
    range: number,
    reserved: bigint | number = 0
): bigint {
    const idBn = BigInt(id);
    const reservedBn = BigInt(reserved);
    if (idBn < 0n || idBn > ID_MAX) throw new Error('ID overflow');
    if (marketType < 0 || marketType > Number(TYPE_MAX)) throw new Error('Type overflow');
    if (startTime < 0 || startTime > Number(START_MAX)) throw new Error('Start overflow');
    if (periodLength < 0 || periodLength > Number(PERIOD_MAX)) throw new Error('Period overflow');
    if (BigInt(strike) < 0n || BigInt(strike) > STRIKE_MAX) throw new Error('Strike overflow');
    if (range < 0 || range > Number(RANGE_MAX)) throw new Error('Range overflow');
    if (reservedBn < 0n || reservedBn > RESERVED_MAX) throw new Error('Reserved overflow');

    return (
        (idBn << BigInt(ID_OFFSET)) |
        (BigInt(marketType) << BigInt(TYPE_OFFSET)) |
        (BigInt(startTime) << BigInt(START_OFFSET)) |
        (BigInt(periodLength) << BigInt(PERIOD_OFFSET)) |
        (BigInt(strike) << BigInt(STRIKE_OFFSET)) |
        (BigInt(range) << BigInt(RANGE_OFFSET)) |
        (reservedBn << BigInt(RESERVED_OFFSET))
    );
}

/**
 * Decode assetId into components (matches PackedAssetId.unpack).
 */
export function decodeAssetId(assetId: bigint): DecodedAssetId {
    const id = Number((assetId >> BigInt(ID_OFFSET)) & ID_MASK);
    const marketType = Number((assetId >> BigInt(TYPE_OFFSET)) & TYPE_MASK);
    const startTime = Number((assetId >> BigInt(START_OFFSET)) & START_MASK);
    const periodLength = Number((assetId >> BigInt(PERIOD_OFFSET)) & PERIOD_MASK);
    const strike = String((assetId >> BigInt(STRIKE_OFFSET)) & STRIKE_MASK);
    const range = Number((assetId >> BigInt(RANGE_OFFSET)) & RANGE_MASK);
    const reserved = String((assetId >> BigInt(RESERVED_OFFSET)) & RESERVED_MASK);
    return {
        id,
        marketType,
        startTime,
        periodLength,
        strike,
        range,
        reserved,
        expiration: startTime + periodLength,
    };
}

/**
 * Convert duration in seconds to timeframe string (e.g. periodLength 900 -> "15m").
 */
export function getExpirationTf(expirationSeconds: number): string {
    const seconds = expirationSeconds;
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(seconds / 3600);
    const days = Math.floor(seconds / 86400);
    const weeks = Math.floor(seconds / 604800);
    const months = Math.floor(seconds / 2592000);
    const years = Math.floor(seconds / 31536000);

    if (years > 0) {
        return `${years}y`;
    } else if (months > 0) {
        return `${months}M`;
    } else if (weeks > 0) {
        return `${weeks}w`;
    } else if (days > 0) {
        return `${days}d`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Parse timeframe string to duration in seconds (e.g. "15m" -> 900).
 */
export function parseExpirationTf(expirationTf: string): number {
    const trimmed = expirationTf.trim();
    const match = trimmed.match(/^(\d+)([smhdwMy])$/);
    if (!match) {
        throw new Error(`Invalid expiration timeframe format: ${expirationTf}. Expected format: <number><unit> (e.g., "15m", "1h", "1d", "1w", "1M", "1y")`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (isNaN(value) || value <= 0) {
        throw new Error(`Invalid expiration timeframe value: ${value}. Must be a positive number`);
    }

    switch (unit) {
        case 's':
        case 'S':
            return value;
        case 'm':
            return value * 60;
        case 'h':
        case 'H':
            return value * 3600;
        case 'd':
        case 'D':
            return value * 86400;
        case 'w':
        case 'W':
            return value * 604800;
        case 'M':
            return value * 2592000;
        case 'y':
        case 'Y':
            return value * 31536000;
        default:
            throw new Error(`Invalid expiration timeframe unit: ${unit}. Must be one of: s, m, h, d, w, M, y`);
    }
}
