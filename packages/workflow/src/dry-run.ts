import type { StepExecutor } from "./types.js";

/**
 * Create a dry-run step executor that never makes real API calls.
 *
 * @param responses - Optional map of bot name to canned response.
 *   If provided, `responses[bot]` is used as the output for that bot.
 *   If not provided (or bot is missing from the map), a placeholder is returned.
 */
export function createDryRunExecutor(
  responses?: Record<string, unknown>,
): StepExecutor {
  return async ({ bot, stepRunId }) => {
    if (responses && bot in responses) {
      return { output: responses[bot], costUsd: 0 };
    }
    return {
      output: `[dry-run] step ${stepRunId} completed`,
      costUsd: 0,
    };
  };
}
