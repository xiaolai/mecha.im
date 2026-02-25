import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaFind } from "@mecha/service";

export function registerFindCommand(program: Command, deps: CommandDeps): void {
  program
    .command("find")
    .description("Find CASAs by tag")
    .option("--tag <tag>", "Filter by tag (repeatable, AND logic)", collect, [])
    .action((opts: { tag: string[] }) => {
      const results = casaFind(deps.mechaDir, deps.processManager, {
        tags: opts.tag.length > 0 ? opts.tag : undefined,
      });

      if (results.length === 0) {
        const tagStr = opts.tag.length > 0 ? opts.tag.join(", ") : "";
        deps.formatter.info(tagStr ? `No CASAs found with tags: ${tagStr}` : "No CASAs found");
        return;
      }

      deps.formatter.table(
        ["Name", "Tags", "Port", "State"],
        results.map((r) => [
          r.name,
          r.tags.join(", ") || "-",
          r.port != null ? String(r.port) : "-",
          r.state,
        ]),
      );
    });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}
