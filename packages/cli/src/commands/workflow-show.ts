import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";
import type { WorkflowDef } from "@mecha/workflow";

/** Register the 'workflow show' subcommand. */
export function registerWorkflowShowCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("show")
    .description("Show workflow definition with step DAG")
    .argument("<name>", "workflow name")
    .action((name: string) =>
      withErrorHandler(deps, async () => {
        const filePath = join(deps.mechaDir, "workflows", `${name}.yaml`);

        if (!existsSync(filePath)) {
          deps.formatter.error(`Workflow "${name}" not found at ${filePath}`);
          return;
        }

        const raw = readFileSync(filePath, "utf-8");
        const def = JSON.parse(raw) as WorkflowDef;

        if (deps.formatter.isJson) {
          deps.formatter.json(def);
          return;
        }

        deps.formatter.info(`Workflow: ${def.name}`);
        if (def.description) deps.formatter.info(`Description: ${def.description}`);
        /* v8 ignore start -- optional fields in workflow definition */
        if (def.budgetUsd !== undefined) deps.formatter.info(`Budget: $${def.budgetUsd}`);

        if (def.inputs) {
          deps.formatter.info("\nInputs:");
          for (const [key, val] of Object.entries(def.inputs)) {
            const dflt = val.default !== undefined ? ` (default: ${String(val.default)})` : "";
            deps.formatter.info(`  ${key}: ${val.type}${dflt}`);
          }
        }
        /* v8 ignore stop */

        deps.formatter.info("\nSteps:");
        for (const [stepName, step] of Object.entries(def.steps)) {
          const deps_list = step.depends?.length ? ` -> depends: [${step.depends.join(", ")}]` : "";
          const gate = step.gate ? ` [gate: ${step.gate}]` : "";
          deps.formatter.info(`  ${stepName}: bot=${step.bot}${deps_list}${gate}`);
        }
      }),
    );
}
