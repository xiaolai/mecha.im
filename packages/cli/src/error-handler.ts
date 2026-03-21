import { MechaError } from "@mecha/core";
import type { CommandDeps } from "./types.js";

/**
 * Wraps a CLI action with MechaError handling.
 * Catches MechaError, prints via formatter, sets exit code.
 * Re-throws all other errors.
 */
export function withErrorHandler(deps: CommandDeps, fn: () => Promise<void>): Promise<void> {
  return fn().catch((err: unknown) => {
    if (err instanceof MechaError) {
      deps.formatter.error(err.message);
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  });
}
