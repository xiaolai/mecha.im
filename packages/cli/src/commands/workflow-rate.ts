import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createScoreStore } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'workflow rate' subcommand. */
export function registerWorkflowRateCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("rate")
    .description("Record a human quality score for a workflow run")
    .argument("<run-id>", "run ID")
    .argument("<score>", "quality score (1-5)")
    .option("--workflow <name>", "associate score with a workflow name")
    .action((runId: string, scoreStr: string, opts: { workflow?: string }) =>
      withErrorHandler(deps, async () => {
        const score = parseInt(scoreStr, 10);
        if (isNaN(score) || score < 1 || score > 5) {
          deps.formatter.error("Score must be an integer between 1 and 5");
          process.exitCode = 1;
          return;
        }

        const store = createScoreStore(join(deps.mechaDir, "observe", "scores"));
        store.record({
          runId,
          workflow: opts.workflow,
          score,
          source: "human",
          scoredAt: new Date().toISOString(),
        });

        deps.formatter.success(`Recorded score ${score}/5 for run ${runId}`);
      }),
    );
}
