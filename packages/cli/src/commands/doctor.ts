import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaDoctor } from "@mecha/service";

export function registerDoctorCommand(program: Command, deps: CommandDeps): void {
  program
    .command("doctor")
    .description("Run system health checks")
    .action(async () => {
      const result = mechaDoctor(deps.mechaDir);
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
    });
}
