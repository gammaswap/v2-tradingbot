import { AsyncLocalStorage } from "node:async_hooks";
import { CFG, type Side } from "../config/config.js";
import { createInitialState, STATE, type RuntimeState } from "./state.js";
import { ORDER_INTENTS, OrderIntentManager } from "./orderIntent.js";
import { QUOTE_COOLDOWNS, QuoteCooldownManager } from "./quoteCooldown.js";

/** The configuration and mutable runtime state belonging to one bot instance. */
export type BotContext = {
  config: typeof CFG;
  state: RuntimeState;
  orderIntents: OrderIntentManager;
  quoteCooldowns: QuoteCooldownManager;
};

const contextStorage = new AsyncLocalStorage<BotContext>();
const defaultContext: BotContext = {
  config: CFG,
  state: STATE,
  orderIntents: ORDER_INTENTS,
  quoteCooldowns: QUOTE_COOLDOWNS,
};

/** Returns the active bot context, retaining the CLI's default context for compatibility. */
export function getBotContext(): BotContext {
  return contextStorage.getStore() ?? defaultContext;
}

/** Runs an async bot lifecycle under its own configuration and state. */
export function runWithBotContext<T>(context: BotContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

/** Creates isolated configuration/state without changing process-wide defaults. */
export function createBotContext(overrides: Partial<typeof CFG> = {}): BotContext {
  const config = { ...CFG, ...overrides };
  return {
    config,
    state: createInitialState(config),
    orderIntents: new OrderIntentManager(),
    quoteCooldowns: new QuoteCooldownManager(undefined, config.ORDER_FAILURE_COOLDOWN_MS),
  };
}

// These proxies let existing runtime code use CFG/STATE syntax while resolving
// to the correct bot when multiple bot lifecycles run concurrently.
export const RUNTIME_CFG = new Proxy({} as typeof CFG, {
  get: (_target, property: keyof typeof CFG) => getBotContext().config[property],
  set: (_target, property: keyof typeof CFG, value: unknown) => {
    (getBotContext().config as any)[property] = value;
    return true;
  },
});

export const RUNTIME_STATE = new Proxy({} as RuntimeState, {
  get: (_target, property: keyof RuntimeState) => getBotContext().state[property],
  set: (_target, property: keyof RuntimeState, value: unknown) => {
    (getBotContext().state as any)[property] = value;
    return true;
  },
});

function contextManager<T extends object>(
  property: keyof Pick<BotContext, "orderIntents" | "quoteCooldowns">,
): T {
  return new Proxy({} as T, {
    get: (_target, key: string | symbol) => {
      const value = (getBotContext()[property] as any)[key];
      return typeof value === "function" ? value.bind(getBotContext()[property]) : value;
    },
  });
}

export const RUNTIME_ORDER_INTENTS = contextManager<OrderIntentManager>("orderIntents");
export const RUNTIME_QUOTE_COOLDOWNS = contextManager<QuoteCooldownManager>("quoteCooldowns");

export type { Side };
