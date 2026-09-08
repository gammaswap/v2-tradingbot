export type QuoteCooldownKey = {
  assetId: string;
  epoch: bigint;
  quoteSlot: string;
};

type QuoteCooldown = QuoteCooldownKey & {
  retryAfter: number;
  reason: string;
};

export class InMemoryQuoteCooldownStore {
  private readonly cooldowns = new Map<string, QuoteCooldown>();

  get(key: QuoteCooldownKey): QuoteCooldown | undefined {
    return this.cooldowns.get(makeQuoteCooldownKey(key));
  }

  set(cooldown: QuoteCooldown): void {
    this.cooldowns.set(makeQuoteCooldownKey(cooldown), cooldown);
  }

  delete(key: QuoteCooldownKey): void {
    this.cooldowns.delete(makeQuoteCooldownKey(key));
  }
}

export class QuoteCooldownManager {
  constructor(
    private readonly store = new InMemoryQuoteCooldownStore(),
    private readonly durationMs = 5_000,
  ) {}

  start(key: QuoteCooldownKey, reason: string, now = Date.now()): void {
    this.store.set({
      ...key,
      retryAfter: now + this.durationMs,
      reason,
    });
  }

  isCoolingDown(key: QuoteCooldownKey, now = Date.now()): boolean {
    const cooldown = this.store.get(key);
    if (!cooldown) return false;

    if (now >= cooldown.retryAfter) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  getRemainingMs(key: QuoteCooldownKey, now = Date.now()): number {
    const cooldown = this.store.get(key);
    return cooldown == null ? 0 : Math.max(0, cooldown.retryAfter - now);
  }
}

function makeQuoteCooldownKey(key: QuoteCooldownKey): string {
  return `${key.assetId}:${key.epoch.toString()}:${key.quoteSlot}`;
}

export const QUOTE_COOLDOWNS = new QuoteCooldownManager();
