import { RUNTIME_CFG } from "../runtime/context.js";

export type LogLevel = "info" | "debug" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: unknown): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

export class Logger {
  private readonly tags: string[];

  constructor(tags: string | string[]) {
    this.tags = Array.isArray(tags) ? tags.slice(0, 3) : [tags]; // max 3
  }

  private timestamp(): string {
    const now = new Date();

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");

    const hh = String(now.getUTCHours()).padStart(2, "0");
    const min = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
    const ms = String(now.getUTCMilliseconds()).padStart(3, "0");

    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms} UTC`;
  }

  private format(level: LogLevel): string {
    const tagString = this.tags.map((t) => `[${t}]`).join("");
    return `[${this.timestamp()}]${tagString}[${level}]`;
  }

  private print(level: LogLevel, ...args: unknown[]) {
    const configuredLevel = RUNTIME_CFG.LOG_LEVEL;
    // Invalid configuration is rejected during startup. Treating it as
    // "info" here keeps the logger safe if it is used before validation.
    const minimumLevel = isLogLevel(configuredLevel) ? configuredLevel : "info";
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minimumLevel]) return;
    console.log(this.format(level), ...args);
  }

  info(...args: unknown[]): void {
    this.print("info", ...args);
  }

  debug(...args: unknown[]): void {
    this.print("debug", ...args);
  }

  warn(...args: unknown[]): void {
    this.print("warn", ...args);
  }

  error(...args: unknown[]): void {
    this.print("error", ...args);
  }
}
