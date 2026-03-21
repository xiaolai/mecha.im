import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { botChat } from "@mecha/service";

const META_BOT_NAME = "meta-agent";

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
