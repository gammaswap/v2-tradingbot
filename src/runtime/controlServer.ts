import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { Logger } from "../utils/logger.js";

const logger = new Logger("controlServer");

export type ControlCommand = "status" | "fair-value" | "health" | "quote";

export type ControlServerOptions = {
    socketPath: string;
    getStatus: () => Record<string, unknown>;
};

export type ControlServer = {
    close(): Promise<void>;
};

function serialize(value: unknown): string {
    return JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    );
}

function responseFor(command: string, getStatus: () => Record<string, unknown>): Record<string, unknown> {
    const status = getStatus();
    if (command === "status" || command === "health") return status;
    if (command === "fair-value") {
        return {
            fairValue: status.fairValue ?? null,
            oracle: status.oracle ?? null,
            referencePrice: status.referencePrice ?? null,
        };
    }
    if (command === "quote") {
        return { quoteModel: status.quoteModel ?? null };
    }
    throw new Error(`unknown command: ${command}`);
}

export function handleControlRequest(
    command: string,
    getStatus: () => Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
    try {
        return { ok: true, data: responseFor(command, getStatus) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function handleSocket(socket: Socket, getStatus: () => Record<string, unknown>): void {
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");
            if (!line) continue;

            try {
                const request = JSON.parse(line) as { command?: string };
                socket.write(`${serialize(handleControlRequest(request.command ?? "status", getStatus))}\n`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                socket.write(`${serialize({ ok: false, error: message })}\n`);
            }
        }
    });
}

export async function startControlServer(options: ControlServerOptions): Promise<ControlServer> {
    if (existsSync(options.socketPath)) unlinkSync(options.socketPath);

    const server: Server = createServer((socket) => handleSocket(socket, options.getStatus));
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.socketPath, () => {
            server.removeListener("error", reject);
            chmodSync(options.socketPath, 0o600);
            resolve();
        });
    });

    logger.info("control server listening", { socketPath: options.socketPath });
    return {
        close: async () => {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
            if (existsSync(options.socketPath)) unlinkSync(options.socketPath);
        },
    };
}
