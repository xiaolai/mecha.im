import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { taskGet } from "@mecha/service";
import { resolveAgentAuth } from "../agent-auth.js";

/** Register the 'task show' subcommand. */
export function registerTaskShowCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("show")
    .description("Show task details")
    .argument("<id>", "Task ID")
    .action((id: string) =>
      withErrorHandler(deps, async () => {
        const { agentUrl, auth } = resolveAgentAuth(deps.mechaDir);

        const task = await taskGet(agentUrl, auth, id);

        if (deps.formatter.isJson) {
          deps.formatter.json(task);
          return;
        }

        deps.formatter.info(`Task: ${task.id}`);
        deps.formatter.info(`Target: ${task.target}`);
        deps.formatter.info(`Status: ${task.status}`);
        deps.formatter.info(`Message: ${task.message}`);
        if (task.result) deps.formatter.info(`Result: ${task.result}`);
        if (task.error) deps.formatter.error(`Error: ${task.error}`);
        if (task.sessionId) deps.formatter.info(`Session: ${task.sessionId}`);
        if (task.durationMs) deps.formatter.info(`Duration: ${task.durationMs}ms`);
        if (task.costUsd) deps.formatter.info(`Cost: $${task.costUsd.toFixed(4)}`);
        deps.formatter.info(`Created: ${task.createdAt}`);
        deps.formatter.info(`Updated: ${task.updatedAt}`);
      }),
    );
}
