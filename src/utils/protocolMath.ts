const PROTOCOL_SCALE = 1_000_000n;

function toProtocolBigInt(value: number | bigint, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer: ${value}`);
  }
  return BigInt(value);
}

export function protocolMulDiv(
  left: number | bigint,
  right: number | bigint,
  denominator: bigint = PROTOCOL_SCALE,
): bigint {
  return (toProtocolBigInt(left, "left") * toProtocolBigInt(right, "right")) / denominator;
}

export function protocolNotionalBigInt(size: number | bigint, price: number | bigint): bigint {
  return protocolMulDiv(size, price);
}

export function protocolValueToSafeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeds JavaScript safe integer range: ${value}`);
  }
  return result;
}

export function protocolNotional(size: number | bigint, price: number | bigint): number {
  return protocolValueToSafeNumber(protocolNotionalBigInt(size, price), "protocol notional");
}
