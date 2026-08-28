import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotContext, runWithBotContext } from "../src/runtime/context.js";
import { Logger } from "../src/utils/logger.js";

describe("Logger", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const [configuredLevel, expectedLevels] of [
        ["debug", ["debug", "info", "warn", "error"]],
        ["info", ["info", "warn", "error"]],
        ["warn", ["warn", "error"]],
        ["error", ["error"]],
    ] as const) {
        it(`prints ${expectedLevels.join(", ")} when configured for ${configuredLevel}`, () => {
            const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
            const logger = new Logger("logger.test.ts");
            const context = createBotContext({ LOG_LEVEL: configuredLevel });

            runWithBotContext(context, () => {
                logger.debug("debug message");
                logger.info("info message");
                logger.warn("warn message");
                logger.error("error message");
            });

            expect(output).toHaveBeenCalledTimes(expectedLevels.length);
            for (const level of expectedLevels) {
                expect(output.mock.calls.some(([prefix]) =>
                    typeof prefix === "string" && prefix.includes(`[${level}]`),
                )).toBe(true);
            }
        });
    }
});
