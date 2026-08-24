import { CFG, type Side } from "../config/config.js";
import type { CancelReplaceInstruction, NewOrderInstruction, PendingOrder } from "../utils/types.js";
import { availableCollateral, canPlaceOrder, shouldCancelReplace } from "./strategy.js";
import { roundToOrderLot } from "../utils/utils.js";
import { protocolNotional } from "../utils/protocolMath.js";

export type OrderPlan = {
    cancelReplaces: CancelReplaceInstruction[];
    cancels: string[];
    newOrders: NewOrderInstruction[];
};

/** Identifies one passive quote level independently of its array position. */
export function makeQuoteSlot(side: Side, price: number): string {
    return `${side}:${price.toString()}`;
}

export function planOrders(
    oldOrders: PendingOrder[],
    newPrices: number[],
    newSizes: number[],
    skewMul: number,
    side: Side,
    initialCollateral = availableCollateral(),
): OrderPlan {
    const isBuy = side === "buy";
    const minLength = Math.min(oldOrders.length, newPrices.length);
    const cancelReplaces: CancelReplaceInstruction[] = [];
    const cancels: string[] = [];
    const newOrders: NewOrderInstruction[] = [];
    let collateral = initialCollateral;

    for (let i = 0; i < minLength; i++) {
        const oldOrder = oldOrders[i];
        const price = newPrices[i];
        const size = roundToOrderLot(newSizes[i] * skewMul);
        const oldMarginPrice = isBuy ? oldOrder.price : 1_000_000 - oldOrder.price;
        const newMarginPrice = isBuy ? price : 1_000_000 - price;
        const oldMargin = protocolNotional(oldOrder.size, oldMarginPrice);
        const newMargin = protocolNotional(size, newMarginPrice);
        const marginChange = newMargin - oldMargin;

        if (marginChange <= 0) {
            if (shouldCancelReplace(oldOrder, price, size)) {
                cancelReplaces.push({ price, size, side: oldOrder.side, cancelId: oldOrder.id, quoteSlot: makeQuoteSlot(side, price) });
                collateral += marginChange;
            }
            continue;
        }

        let replacementSize = size;
        let replacementMarginChange = marginChange;
        let permitted = canPlaceOrder(isBuy, size, price, collateral + oldMargin);
        if (!permitted) {
            replacementSize = oldOrder.size;
            const replacementMargin = protocolNotional(replacementSize, newMarginPrice);
            replacementMarginChange = replacementMargin - oldMargin;
            permitted = replacementMarginChange <= 0 || canPlaceOrder(
                isBuy,
                replacementSize,
                price,
                collateral + oldMargin,
            );
        }

        if (permitted) {
            if (shouldCancelReplace(oldOrder, price, replacementSize)) {
                cancelReplaces.push({
                    price,
                    size: replacementSize,
                    side: oldOrder.side,
                    cancelId: oldOrder.id,
                    quoteSlot: makeQuoteSlot(side, price),
                });
                collateral += replacementMarginChange;
            }
        } else {
            cancels.push(oldOrder.id);
            collateral -= oldMargin;
        }
    }

    if (oldOrders.length < newPrices.length) {
        for (let i = minLength; i < newPrices.length; i++) {
            const price = newPrices[i];
            const size = roundToOrderLot(newSizes[i] * skewMul);
            const newMargin = protocolNotional(size, isBuy ? price : 1_000_000 - price);
            if (!canPlaceOrder(isBuy, size, price, collateral)) continue;

            newOrders.push({ price, size, side, quoteSlot: makeQuoteSlot(side, price) });
            collateral += newMargin;
        }
    } else if (oldOrders.length > newPrices.length) {
        for (let i = minLength; i < oldOrders.length; i++) {
            cancels.push(oldOrders[i].id);
        }
    }

    return { cancelReplaces, cancels, newOrders };
}
