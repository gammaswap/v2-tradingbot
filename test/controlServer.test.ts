import { describe, expect, it } from "vitest";
import { handleControlRequest } from "../src/runtime/controlServer.js";

describe("bot control server", () => {
    it("returns status data and serializes bigint values", async () => {
        expect(handleControlRequest("status", () => ({
            epoch: 42n,
            fairValue: { protocolPrice: 600_000 },
        }))).toEqual({
            ok: true,
            data: { epoch: 42n, fairValue: { protocolPrice: 600_000 } },
        });
    });

    it("returns an error for an unknown command", async () => {
        expect(handleControlRequest("cancel-all", () => ({}))).toEqual({
            ok: false,
            error: "unknown command: cancel-all",
        });
    });
});
