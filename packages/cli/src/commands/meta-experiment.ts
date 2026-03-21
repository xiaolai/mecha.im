import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createExperiment } from "@mecha/observe";

/* v8 ignore start -- experiment config writing is low-priority; requires @mecha/observe */
/** Register the 'meta experiment' subcommand. */
export function registerMetaExperimentCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("experiment")
    .description("Create an A/B test experiment definition")
    .argument("<name>", "Experiment name")
    .requiredOption("--config-a <file>", "Config file for variant A")
    .requiredOption("--config-b <file>", "Config file for variant B")
    .requiredOption("--workflow <name>", "Workflow to test")
    .option("--runs <n>", "Number of runs per variant", "5")
    .action(async (
      name: string,
      opts: { configA: string; configB: string; workflow: string; runs: string },
    ) => withErrorHandler(deps, async () => {
      const configA = JSON.parse(readFileSync(opts.configA, "utf-8")) as Record<string, unknown>;
      const configB = JSON.parse(readFileSync(opts.configB, "utf-8")) as Record<string, unknown>;
      const runs = parseInt(opts.runs, 10) || 5;

      const experiment = createExperiment({
        name,
        variantA: { label: "A", config: configA },
        variantB: { label: "B", config: configB },
        workflow: opts.workflow,
        runs,
      });

      // Store experiment definition
      const experimentsDir = join(deps.mechaDir, "observe", "experiments");
      mkdirSync(experimentsDir, { recursive: true });
      const experimentPath = join(experimentsDir, `${name}.json`);
      writeFileSync(experimentPath, JSON.stringify(experiment, null, 2) + "\n");

      deps.formatter.success(`Experiment "${name}" created at ${experimentPath}`);
      deps.formatter.info(`  Workflow: ${opts.workflow}`);
      deps.formatter.info(`  Runs per variant: ${runs}`);
      deps.formatter.info(`  Variant A: ${opts.configA}`);
      deps.formatter.info(`  Variant B: ${opts.configB}`);
    }));
}
/* v8 ignore stop */
