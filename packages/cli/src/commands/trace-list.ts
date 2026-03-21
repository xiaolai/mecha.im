import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createTraceStore } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'trace list' subcommand. */
export function registerTraceListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List recent traces, optionally filtered by workflow")
    .argument("[workflow]", "workflow name (omit for all)")
    .action((workflow?: string) =>
      withErrorHandler(deps, async () => {
        const store = createTraceStore(join(deps.mechaDir, "observe", "traces"));

        if (workflow) {
          const traces = store.list(workflow);

          if (traces.length === 0) {
            deps.formatter.info(`No traces found for workflow "${workflow}"`);
            return;
          }

          if (deps.formatter.isJson) {
            deps.formatter.json(traces);
            return;
          }

          deps.formatter.table(
            ["Run ID", "Status", "Started", "Cost"],
            traces.map((t) => [
              t.traceId,
              t.status,
              t.startedAt,
              `$${t.totalCostUsd.toFixed(4)}`,
            ]),
          );
          return;
        }

        // List all workflows and their recent traces
        const workflows = store.workflows();

        if (workflows.length === 0) {
          deps.formatter.info("No traces found");
          return;
        }

        const allTraces = workflows.flatMap((wf) =>
          store.list(wf).map((t) => ({ ...t, workflow: wf })),
        );

        allTraces.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

        if (deps.formatter.isJson) {
          deps.formatter.json(allTraces);
          return;
        }

        deps.formatter.table(
          ["Workflow", "Run ID", "Status", "Started", "Cost"],
          allTraces.map((t) => [
            t.workflow,
            t.traceId,
            t.status,
            t.startedAt,
            `$${t.totalCostUsd.toFixed(4)}`,
          ]),
        );
      }),
    );
}
