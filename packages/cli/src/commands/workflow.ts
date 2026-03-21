import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerWorkflowListCommand } from "./workflow-list.js";
import { registerWorkflowShowCommand } from "./workflow-show.js";
import { registerWorkflowRunCommand } from "./workflow-run.js";
import { registerWorkflowRunsCommand } from "./workflow-runs.js";
import { registerWorkflowRunDetailCommand } from "./workflow-run-detail.js";
import { registerWorkflowApproveCommand } from "./workflow-approve.js";
import { registerWorkflowCancelCommand } from "./workflow-cancel.js";
import { registerWorkflowRateCommand } from "./workflow-rate.js";

/** Register the 'workflow' command group. */
export function registerWorkflowCommand(program: Command, deps: CommandDeps): void {
  const workflow = program
    .command("workflow")
    .alias("wf")
    .description("Manage multi-step workflows");

  registerWorkflowListCommand(workflow, deps);
  registerWorkflowShowCommand(workflow, deps);
  registerWorkflowRunCommand(workflow, deps);
  registerWorkflowRunsCommand(workflow, deps);
  registerWorkflowRunDetailCommand(workflow, deps);
  registerWorkflowApproveCommand(workflow, deps);
  registerWorkflowCancelCommand(workflow, deps);
  registerWorkflowRateCommand(workflow, deps);
}
