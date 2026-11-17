import type { WebSocketMarketUpdate, WebSocketTradeUpdate } from "@gammaswap/v2-exchange-sdk";

export type RuntimeEvent =
  | { type: "market"; update: WebSocketMarketUpdate }
  | { type: "market-resync"; reason: string }
  | { type: "market-trade"; update: WebSocketTradeUpdate }
  | { type: "oracle-state-changed" };

export class RuntimeEventQueue {
  private readonly events: RuntimeEvent[] = [];
  private waiter: (() => void) | null = null;

  publish(event: RuntimeEvent): void {
    this.events.push(event);
    this.wake();
  }

  wake(): void {
    this.waiter?.();
    this.waiter = null;
  }

  drain(): RuntimeEvent[] {
    return this.events.splice(0);
  }

  async wait(timeoutMs: number): Promise<void> {
    if (this.events.length > 0) return;

    await new Promise<void>((resolve) => {
      this.waiter = resolve;
      setTimeout(
        () => {
          if (this.waiter === resolve) {
            this.waiter = null;
            resolve();
          }
        },
        Math.max(0, timeoutMs),
      );
    });
  }
}
