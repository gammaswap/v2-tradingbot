export const PROTOCOL_MIN_PRICE = 1_000;
export const PROTOCOL_MAX_PRICE = 999_000;
export const SDK_PRICE_STEP = 1_000;

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
