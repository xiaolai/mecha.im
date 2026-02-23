import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaDoctor } from "@mecha/service";

export function registerDoctorCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("doctor")
    .description("Check system requirements")
    .action(async () => {
      const { formatter } = deps;

      const result = await mechaDoctor();

      if (result.claudeCliAvailable) {
        formatter.success("Claude CLI: available");
      } else {
        formatter.error("Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview");
      }

      if (result.sandboxSupported) {
        formatter.success("Sandbox: supported");
      } else {
        formatter.error("Sandbox not supported on this platform.");
      }

      if (result.issues.length === 0) {
        formatter.success("All checks passed.");
      } else {
        process.exitCode = 1;
      }
    });
}
