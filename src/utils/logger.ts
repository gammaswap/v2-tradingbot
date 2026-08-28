type LogLevel = "info" | "debug" | "warn" | "error";

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
        const tagString = this.tags.map(t => `[${t}]`).join("");
        return `[${this.timestamp()}]${tagString}[${level}]`;
    }

    private print(level: LogLevel, ...args: unknown[]) {
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