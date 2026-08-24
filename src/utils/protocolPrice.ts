export const PROTOCOL_MIN_PRICE = 1_000;
export const PROTOCOL_MAX_PRICE = 999_000;
export const SDK_PRICE_STEP = 1_000;
export const PROTOCOL_MIN_SIZE = 10_000;
export const PROTOCOL_MAX_SIZE = 100_000_000_000;
export const SDK_SIZE_STEP = 10_000;
export const PROTOCOL_MIN_ORDER_MARGIN = 10n;
const PROTOCOL_SCALE = 1_000_000n;

export function assertProtocolPrice(
    price: number | bigint,
    label = "price",
): void {
    if (typeof price === "number" && !Number.isSafeInteger(price)) {
        throw new Error(`${label} must be a safe integer: ${price}`);
    }

    const value = typeof price === "bigint" ? price : BigInt(price);
    const min = BigInt(PROTOCOL_MIN_PRICE);
    const max = BigInt(PROTOCOL_MAX_PRICE);
    const step = BigInt(SDK_PRICE_STEP);

    if (value < min) {
        throw new Error(`${label} ${value} is below protocol minimum ${PROTOCOL_MIN_PRICE}`);
    }

    if (value > max) {
        throw new Error(`${label} ${value} is above protocol maximum ${PROTOCOL_MAX_PRICE}`);
    }

    if (value % step !== 0n) {
        throw new Error(`${label} ${value} is not representable by the SDK price scale`);
    }
}

export function assertProtocolSize(
    size: number | bigint,
    label = "size",
): void {
    if (typeof size === "number" && (!Number.isSafeInteger(size) || size < 0)) {
        throw new Error(`${label} must be a non-negative safe integer: ${size}`);
    }

    const value = typeof size === "bigint" ? size : BigInt(size);
    const min = BigInt(PROTOCOL_MIN_SIZE);
    const max = BigInt(PROTOCOL_MAX_SIZE);
    const step = BigInt(SDK_SIZE_STEP);

    if (value < min) throw new Error(`${label} is below protocol minimum ${PROTOCOL_MIN_SIZE}`);
    if (value > max) throw new Error(`${label} exceeds protocol maximum ${PROTOCOL_MAX_SIZE}`);
    if (value % step !== 0n) throw new Error(`${label} is not a valid SDK lot size`);
}

export function assertProtocolOrder(
    side: "buy" | "sell",
    size: number | bigint,
    price: number | bigint,
): void {
    assertProtocolPrice(price);
    assertProtocolSize(size);

    const sizeValue = typeof size === "bigint" ? size : BigInt(size);
    const priceValue = typeof price === "bigint" ? price : BigInt(price);
    const effectivePrice = side === "buy"
        ? priceValue
        : PROTOCOL_SCALE - priceValue;
    const margin = (sizeValue * effectivePrice) / PROTOCOL_SCALE;

    if (margin < PROTOCOL_MIN_ORDER_MARGIN) {
        throw new Error(`order margin ${margin} is below protocol minimum ${PROTOCOL_MIN_ORDER_MARGIN}`);
    }
}

export function maxSizeForMargin(
    side: "buy" | "sell",
    price: number | bigint,
    marginBudget: number | bigint,
): bigint {
    assertProtocolPrice(price);
    if (typeof marginBudget === "number" && (!Number.isSafeInteger(marginBudget) || marginBudget < 0)) {
        throw new Error(`margin budget must be a non-negative safe integer: ${marginBudget}`);
    }

    const priceValue = typeof price === "bigint" ? price : BigInt(price);
    const budgetValue = typeof marginBudget === "bigint" ? marginBudget : BigInt(marginBudget);
    const effectivePrice = side === "buy"
        ? priceValue
        : PROTOCOL_SCALE - priceValue;

    return (budgetValue * PROTOCOL_SCALE) / effectivePrice;
}
