import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readNodes, readDiscoveredNodes } from "@mecha/core";

export function registerNodeLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List registered peer nodes")
    .action(() => {
      const nodes = readNodes(deps.mechaDir);
      const discovered = readDiscoveredNodes(deps.mechaDir);
      if (nodes.length === 0 && discovered.length === 0) {
        deps.formatter.info("No peer nodes registered");
        return;
      }
      const manualRows = nodes.map((n) => [
        n.name,
        n.managed ? "managed" : "http",
        "manual",
        n.managed ? "—" : n.host,
        n.managed ? "—" : String(n.port),
        n.addedAt,
      ]);
      const discoveredRows = discovered.map((d) => [
        d.name,
        d.source,
        "discovered",
        d.host,
        String(d.port),
        d.lastSeen,
      ]);
      deps.formatter.table(
        ["Name", "Type", "Source", "Host", "Port", "Last Seen"],
        [...manualRows, ...discoveredRows],
      );
    });
}
