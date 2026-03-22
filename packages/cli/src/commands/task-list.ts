import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { taskList } from "@mecha/service";
import { resolveAgentAuth } from "../agent-auth.js";

/** Register the 'task list' subcommand. */
export function registerTaskListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List tasks")
    .option("--target <bot>", "Filter by target bot")
    .option("--status <status>", "Filter by status (pending, working, completed, failed, cancelled)")
    .action((opts: { target?: string; status?: string }) =>
      withErrorHandler(deps, async () => {
        const { agentUrl, auth } = resolveAgentAuth(deps.mechaDir);

        const tasks = await taskList(agentUrl, auth, {
          target: opts.target,
          status: opts.status,
        });

        if (deps.formatter.isJson) {
          deps.formatter.json(tasks);
          return;
        }

        if (tasks.length === 0) {
          deps.formatter.info("No tasks found");
          return;
        }

        deps.formatter.table(
          ["ID", "Target", "Status", "Message", "Updated"],
          tasks.map((t) => [
            t.id,
            t.target,
            t.status,
            t.message.length > 40 ? t.message.slice(0, 37) + "..." : t.message,
            t.updatedAt,
          ]),
        );
      }),
    );
}
