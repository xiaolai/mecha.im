import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaDoctor } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'doctor' command. */
export function registerDoctorCommand(program: Command, deps: CommandDeps): void {
  program
    .command("doctor")
    .description("Run system health checks")
    .action(async () => withErrorHandler(deps, async () => {
      const result = mechaDoctor(deps.mechaDir);

      // Add sandbox availability check
      const sandbox = deps.sandbox;
      /* v8 ignore start -- sandbox availability is platform-dependent */
      const available = sandbox.isAvailable();
      result.checks.push({
        name: "sandbox",
        status: available ? "ok" : "warn",
        message: sandbox.describe(),
      });
      /* v8 ignore stop */

      for (const check of result.checks) {
        const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
        const fn = check.status === "ok" ? "success" : check.status === "warn" ? "warn" : "error";
        deps.formatter[fn](`[${icon}] ${check.name}: ${check.message}`);
      }
      if (result.healthy) {
        deps.formatter.success("System is healthy");
      } else {
        deps.formatter.error("System has issues");
        process.exitCode = 1;
      }
    }));
}
