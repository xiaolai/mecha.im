import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaFind, buildHierarchy, flattenHierarchy } from "@mecha/service";

export function registerLsCommand(program: Command, deps: CommandDeps): void {
  program
    .command("ls")
    .description("List CASA processes")
    .action(async () => {
      const list = casaFind(deps.mechaDir, deps.processManager, {});
      if (list.length === 0) {
        deps.formatter.info("No CASAs running");
        return;
      }

      const tree = buildHierarchy(list);
      const flat = flattenHierarchy(tree);

      deps.formatter.table(
        ["Name", "State", "Port", "PID", "Tags"],
        flat.map(({ casa, depth }) => [
          "  ".repeat(depth) + casa.name,
          casa.state,
          String(casa.port ?? "-"),
          String(casa.pid ?? "-"),
          casa.tags.join(", ") || "-",
        ]),
      );
    });
}
