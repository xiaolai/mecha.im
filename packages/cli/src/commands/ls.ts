import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
export function registerLsCommand(program: Command, deps: CommandDeps): void {
  program
    .command("ls")
    .description("List CASA processes")
    .action(async () => {
      const list = deps.processManager.list();
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
