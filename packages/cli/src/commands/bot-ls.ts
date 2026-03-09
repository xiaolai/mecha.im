import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botFind, buildHierarchy, flattenHierarchy } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot ls' subcommand. */
export function registerBotLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List bot processes")
    .action(async () => withErrorHandler(deps, async () => {
      const list = botFind(deps.mechaDir, deps.processManager, {});
      if (list.length === 0) {
        deps.formatter.info("No bots running");
        return;
      }

      const tree = buildHierarchy(list);
      const flat = flattenHierarchy(tree);

      deps.formatter.table(
        ["Name", "State", "Port", "PID", "Tags"],
        flat.map(({ bot, depth }) => [
          "  ".repeat(depth) + bot.name,
          bot.state,
          String(bot.port ?? "-"),
          String(bot.pid ?? "-"),
          bot.tags.join(", ") || "-",
        ]),
      );
    }));
}
