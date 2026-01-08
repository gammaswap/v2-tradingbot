import { CFG } from "./config.js";
import type { BookSnapshot, PendingOrder } from "./types.js";

export const STATE = {
    book: null as BookSnapshot | null,
    pending: new Map<string, PendingOrder>(),
    localOrderTs: new Map<string, number>(),

    // optional local ledger (first iteration)
    baseBal: CFG.START_BASE_BAL,
    quoteBal: CFG.START_QUOTE_BAL,
    invBase: 0,

    lastMid: CFG.CENTER_PRICE,
};
