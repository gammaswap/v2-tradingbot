import type { RuntimeState } from "./state.js";

export function canTradeCurrentAsset(state: RuntimeState): boolean {
  return Boolean(state.asset && !state.asset.isResolved && state.asset.epoch === state.epoch);
}
