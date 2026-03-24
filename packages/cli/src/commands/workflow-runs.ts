import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";
import type { RunState } from "@mecha/workflow";

/** Register the 'workflow runs' subcommand. */
export function registerWorkflowRunsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("runs")
    .description("List run history for a workflow")
    .argument("<name>", "workflow name")
    .option("--last <count>", "Show only the last N runs")
    .action((name: string, opts: { last?: string }) =>
      withErrorHandler(deps, async () => {
        const runsDir = join(deps.mechaDir, "workflows", "runs", name);

        /* v8 ignore start -- empty runs directory branch */
        if (!existsSync(runsDir)) {
          deps.formatter.info(`No runs found for workflow "${name}"`);
          return;
        }

        const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));

        if (files.length === 0) {
          deps.formatter.info(`No runs found for workflow "${name}"`);
          return;
        }
        /* v8 ignore stop */

        const runs: RunState[] = [];
        for (const file of files) {
          const raw = readFileSync(join(runsDir, file), "utf-8");
          runs.push(JSON.parse(raw) as RunState);
        }

        // Sort by startedAt descending
        /* v8 ignore start -- sort comparator */
        runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        /* v8 ignore stop */

        const displayRuns = opts.last ? runs.slice(0, parseInt(opts.last, 10)) : runs;

        if (deps.formatter.isJson) {
          deps.formatter.json(displayRuns);
          return;
        }

        deps.formatter.table(
          ["Run ID", "Status", "Started", "Cost"],
          displayRuns.map((r) => [
            r.runId,
            r.status,
            r.startedAt,
            `$${r.totalCostUsd.toFixed(4)}`,
          ]),
        );
      }),
    );
}
