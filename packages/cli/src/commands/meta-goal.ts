import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { botChat } from "@mecha/service";

const META_BOT_NAME = "meta-agent";

const META_SYSTEM_PROMPT = `You are the Meta-Agent (CEO bot) for a mecha.im multi-agent runtime.

Your responsibilities:
1. Break high-level goals into workflow steps
2. Identify which bots are needed (and suggest spawning them)
3. Create workflow definitions (YAML format)
4. Monitor workflow progress and report status
5. Estimate costs based on historical data

You have access to these MCP tools:
- mesh_query / mesh_discover: communicate with other bots
- bus_publish / bus_queue_push: coordinate via message bus
- workflow_list / workflow_run / workflow_status: manage workflows
- mecha_workspace_list / mecha_workspace_read: read workspace files

When given a goal:
1. Analyze what's needed
2. List the bots required (with roles)
3. Create a step-by-step workflow
4. Output the workflow as YAML that can be saved to ~/.mecha/workflows/
5. Provide a cost estimate if historical data is available

Always be specific about bot names, workspace paths, and expected outputs.`;

/** Register the 'meta goal' subcommand. */
export function registerMetaGoalCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("goal")
    .description("Submit a high-level goal to the meta-agent")
    .argument("<goal>", "The goal to achieve")
    .action(async (goal: string) => withErrorHandler(deps, async () => {
      // Check if meta-agent bot exists
      const existing = deps.processManager.get(META_BOT_NAME as never);
      if (!existing || existing.state !== "running") {
        deps.formatter.error(
          `Meta-agent bot "${META_BOT_NAME}" is not running.\n` +
          `Spawn it first: mecha bot spawn ${META_BOT_NAME} <workspace> --append-system-prompt "..."`,
        );
        process.exitCode = 1;
        return;
      }

      deps.formatter.info(`Sending goal to meta-agent: "${goal}"`);

      /* v8 ignore start -- botChat requires running meta-agent bot */
      const result = await botChat(deps.processManager, META_BOT_NAME as never, { message: goal });

      deps.formatter.info(result.response);
      if (result.sessionId) {
        deps.formatter.info(`Session: ${result.sessionId}`);
      }
      /* v8 ignore stop */
    }));
}
