import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { nodePing } from "@mecha/service";

export function registerNodePingCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ping")
    .description("Test connectivity to a peer node")
    .argument("<name>", "Peer node name")
    .option("--server <url>", "Rendezvous server URL (overrides default)")
    .action(async (name: string, opts: { server?: string }) => withErrorHandler(deps, async () => {
      const result = await nodePing(deps.mechaDir, name, opts);
      if (result.reachable) {
        deps.formatter.success(`${name}: ${result.latencyMs}ms (${result.method})`);
      } else {
        deps.formatter.error(`${name}: ${result.error === "offline"
          ? "offline (not registered on rendezvous)"
          : result.error === "unreachable"
            ? result.method === "rendezvous" ? "rendezvous server unreachable" : "unreachable"
            : result.method === "rendezvous"
              ? `rendezvous lookup failed (${result.error})`
              : result.error!}`);
        process.exitCode = 1;
      }
    }));
}
