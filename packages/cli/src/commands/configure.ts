import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaConfigure } from "@mecha/service";

export function registerConfigureCommand(program: Command, deps: CommandDeps): void {
  program
    .command("configure")
    .description("Update CASA configuration")
    .argument("<name>", "CASA name")
    .option("--tags <tags>", "Comma-separated tags")
    .action((name: string, opts: { tags?: string }) => {
      const validated = casaName(name);
      const updates: { tags?: string[] } = {};
      if (opts.tags) {
        updates.tags = opts.tags.split(",").map((t) => t.trim()).filter(Boolean);
      }
      casaConfigure(deps.mechaDir, deps.processManager, validated, updates);
      deps.formatter.success(`${validated} updated`);
    });
}
