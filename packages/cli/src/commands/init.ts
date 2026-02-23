import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaInit } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerInitCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("init")
    .description("Initialize mecha environment")
    .action(async () => {
      const { formatter } = deps;
      try {
        await mechaInit();
        formatter.success("Mecha initialized successfully.");
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
