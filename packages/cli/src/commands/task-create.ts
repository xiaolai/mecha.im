import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { taskCreate } from "@mecha/service";
import { resolveAgentAuth } from "../agent-auth.js";

/** Register the 'task create' subcommand. */
export function registerTaskCreateCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("create")
    .description("Create a task for a bot to execute")
    .argument("<target>", "Bot name to run the task")
    .argument("<message>", "Task message/instruction")
    .action((target: string, message: string) =>
      withErrorHandler(deps, async () => {
        const { agentUrl, auth } = resolveAgentAuth(deps.mechaDir);

        const result = await taskCreate(agentUrl, auth, { target, message });

        if (deps.formatter.isJson) {
          deps.formatter.json(result);
          return;
        }

        deps.formatter.success(`Task ${result.id} created (status: ${result.status})`);
      }),
    );
}
