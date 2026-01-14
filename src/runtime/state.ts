import { CFG } from "../config/config.js";
import type { BookSnapshot, PendingOrder } from "../utils/types.js";

export const STATE = {
    book: null as BookSnapshot | null,
    pending: new Map<string, PendingOrder>(),
    localOrderTs: new Map<string, number>(),

    // optional local ledger (first iteration)
    baseBal: 0,
    invBase: 0,

    lastMid: CFG.CENTER_PRICE,

    account: CFG.USER_ADDRESS,
};
