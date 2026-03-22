import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { taskCancel } from "@mecha/service";
import { resolveAgentAuth } from "../agent-auth.js";

/** Register the 'task cancel' subcommand. */
export function registerTaskCancelCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("cancel")
    .description("Cancel a running task")
    .argument("<id>", "Task ID")
    .action((id: string) =>
      withErrorHandler(deps, async () => {
        const { agentUrl, auth } = resolveAgentAuth(deps.mechaDir);

        await taskCancel(agentUrl, auth, id);
        deps.formatter.success(`Task ${id} cancelled`);
      }),
    );
}
