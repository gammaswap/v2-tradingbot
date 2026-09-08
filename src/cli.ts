import { connect } from "node:net";

type Response = {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: string;
};

function usage(): never {
    console.error("Usage: pnpm bot <status|quote|fair-value|health> --bot <name>");
    process.exit(1);
}

function socketPath(botName: string): string {
    const normalized = botName.endsWith("-bot") ? botName : `${botName}-bot`;
    return process.env.CONTROL_SOCKET_DIR
        ? `${process.env.CONTROL_SOCKET_DIR}/gammaswap-${normalized}.sock`
        : `/tmp/gammaswap-${normalized}.sock`;
}

function parseArgs(): { command: string; bot: string } {
    const args = process.argv.slice(2);
    const command = args[0] ?? "status";
    const botIndex = args.indexOf("--bot");
    const bot = botIndex >= 0 ? args[botIndex + 1] : undefined;
    if (!bot || !["status", "quote", "fair-value", "health"].includes(command)) usage();
    return { command, bot };
}

async function request(command: string, bot: string): Promise<Response> {
    return new Promise((resolve, reject) => {
        const socket = connect(socketPath(bot));
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline < 0) return;
            socket.end();
            try {
                resolve(JSON.parse(buffer.slice(0, newline)) as Response);
            } catch (error) {
                reject(error);
            }
        });
        socket.once("error", reject);
        socket.write(`${JSON.stringify({ command })}\n`);
    });
}

const { command, bot } = parseArgs();
request(command, bot)
    .then((response) => {
        if (!response.ok) {
            console.error(response.error ?? "control request failed");
            process.exitCode = 1;
            return;
        }
        console.log(JSON.stringify(response.data, null, 2));
    })
    .catch((error) => {
        console.error(`unable to contact ${bot}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
