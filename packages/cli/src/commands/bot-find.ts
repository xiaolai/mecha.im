import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botFind } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot find' subcommand. */
export function registerBotFindCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("find")
    .description("Find bots (all, or filtered by tag)")
    .option("--tag <tag>", "Filter by tag (repeatable, AND logic)", collect, [])
    .action(async (opts: { tag: string[] }) => withErrorHandler(deps, async () => {
      const results = botFind(deps.mechaDir, deps.processManager, {
        tags: opts.tag.length > 0 ? opts.tag : undefined,
      });

      if (results.length === 0) {
        const tagStr = opts.tag.length > 0 ? opts.tag.join(", ") : "";
        deps.formatter.info(tagStr ? `No bots found with tags: ${tagStr}` : "No bots found");
        return;
      }

      deps.formatter.table(
        ["Name", "State", "Port", "Tags"],
        results.map((r) => [
          r.name,
          r.state,
          r.port != null ? String(r.port) : "-",
          r.tags.join(", ") || "-",
        ]),
      );
    }));
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}
