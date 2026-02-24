import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaLs } from "@mecha/service";

export function registerLsCommand(program: Command, deps: CommandDeps): void {
  program
    .command("ls")
    .description("List CASA processes")
    .action(async () => {
      const list = casaLs(deps.processManager);
      if (list.length === 0) {
        deps.formatter.info("No CASAs running");
        return;
      }
      deps.formatter.table(
        ["Name", "State", "Port", "PID"],
        list.map((p) => [p.name, p.state, String(p.port ?? "-"), String(p.pid ?? "-")]),
      );
    });
}
