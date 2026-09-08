import { describe, expect, it } from "vitest";
import { handleControlRequest } from "../src/runtime/controlServer.js";

describe("bot control server", () => {
  it("returns status data and serializes bigint values", async () => {
    expect(
      handleControlRequest("status", () => ({
        epoch: 42n,
        fairValue: { protocolPrice: 600_000 },
      })),
    ).toEqual({
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

  it("returns the latest quote-model snapshot", () => {
    const quoteModel = {
      updatedAtMs: 123,
      bookMid: 500_000,
      referencePrice: 510_000,
      gamma: 0.01,
      inventorySkew: 0.002,
      calculatedBid: 490_000,
      calculatedAsk: 530_000,
      calculatedMid: 510_000,
      bidSize: 100_000_000,
      askSize: 80_000_000,
    };

    expect(handleControlRequest("quote", () => ({ quoteModel }))).toEqual({
      ok: true,
      data: { quoteModel },
    });
  });
});
