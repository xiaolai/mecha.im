import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaScheduleAdd } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Add a periodic schedule to a CASA")
    .argument("<casa>", "CASA name")
    .requiredOption("--id <id>", "Schedule ID (lowercase, alphanumeric, hyphens)")
    .requiredOption("--every <interval>", 'Interval (e.g. "30s", "5m", "1h")')
    .requiredOption("--prompt <prompt>", "Prompt to send on each run")
    .action((casa: string, opts: { id: string; every: string; prompt: string }) =>
      withErrorHandler(deps, async () => {
        const name = casaName(casa);
        await casaScheduleAdd(deps.processManager, name, {
          id: opts.id,
          every: opts.every,
          prompt: opts.prompt,
        });
        deps.formatter.success(`Schedule "${opts.id}" added to ${casa} (every ${opts.every})`);
      }),
    );
}
