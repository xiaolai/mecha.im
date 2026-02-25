import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaFind } from "@mecha/service";

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
      deps.formatter.table(
        ["Name", "State", "Port", "PID", "Tags"],
        list.map((p) => [
          p.name,
          p.state,
          String(p.port ?? "-"),
          String(p.pid ?? "-"),
          p.tags.join(", ") || "-",
        ]),
      );
    });
}
