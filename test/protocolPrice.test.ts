import { describe, expect, it } from "vitest";
import {
    PROTOCOL_MAX_PRICE,
    PROTOCOL_MIN_PRICE,
    PROTOCOL_MAX_SIZE,
    PROTOCOL_MIN_SIZE,
    assertProtocolOrder,
    assertProtocolPrice,
    assertProtocolSize,
} from "../src/utils/protocolPrice.js";

describe("protocol price validation", () => {
    it("accepts the protocol endpoints", () => {
        expect(() => assertProtocolPrice(PROTOCOL_MIN_PRICE)).not.toThrow();
        expect(() => assertProtocolPrice(PROTOCOL_MAX_PRICE)).not.toThrow();
    });

    it("rejects prices outside the protocol range", () => {
        expect(() => assertProtocolPrice(PROTOCOL_MIN_PRICE - 1)).toThrow();
        expect(() => assertProtocolPrice(PROTOCOL_MAX_PRICE + 1)).toThrow();
    });

    it("rejects prices that the SDK cannot represent", () => {
        expect(() => assertProtocolPrice(PROTOCOL_MIN_PRICE + 1)).toThrow();
    });

    it("accepts the minimum and maximum order sizes", () => {
        expect(() => assertProtocolSize(PROTOCOL_MIN_SIZE)).not.toThrow();
        expect(() => assertProtocolSize(PROTOCOL_MAX_SIZE)).not.toThrow();
    });

    it("rejects invalid order sizes", () => {
        expect(() => assertProtocolSize(PROTOCOL_MIN_SIZE - 1)).toThrow();
        expect(() => assertProtocolSize(PROTOCOL_MIN_SIZE + 1)).toThrow();
        expect(() => assertProtocolSize(PROTOCOL_MAX_SIZE + 1)).toThrow();
    });

    it("checks the minimum order margin with exact arithmetic", () => {
        expect(() => assertProtocolOrder("buy", PROTOCOL_MIN_SIZE, PROTOCOL_MIN_PRICE)).not.toThrow();
        expect(() => assertProtocolOrder("sell", PROTOCOL_MIN_SIZE, PROTOCOL_MAX_PRICE)).not.toThrow();
    });
});
