import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, validateTags } from "@mecha/core";
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
        const result = validateTags(opts.tags.split(",").map((t) => t.trim()).filter(Boolean));
        if (!result.ok) {
          deps.formatter.error(result.error);
          process.exitCode = 1;
          return;
        }
        updates.tags = result.tags;
      }
      if (Object.keys(updates).length === 0) {
        deps.formatter.info("Nothing to update");
        return;
      }
      casaConfigure(deps.mechaDir, deps.processManager, validated, updates);
      deps.formatter.success(`${validated} updated`);
    });
}
