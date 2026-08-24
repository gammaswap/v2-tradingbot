import { describe, expect, it } from "vitest";
import {
    PROTOCOL_MAX_PRICE,
    PROTOCOL_MIN_PRICE,
    assertProtocolPrice,
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
});
