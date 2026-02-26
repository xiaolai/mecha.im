import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readNodes } from "@mecha/core";

export function registerNodeLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List registered peer nodes")
    .action(() => {
      const nodes = readNodes(deps.mechaDir);
      if (nodes.length === 0) {
        deps.formatter.info("No peer nodes registered");
        return;
      }
      deps.formatter.table(
        ["Name", "Type", "Host", "Port", "Added"],
        nodes.map((n) => [
          n.name,
          n.managed ? "managed" : "http",
          n.managed ? "—" : n.host,
          n.managed ? "—" : String(n.port),
          n.addedAt,
        ]),
      );
    });
}
