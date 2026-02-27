import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { getNode, NodeNotFoundError, DEFAULTS } from "@mecha/core";

export function registerNodePingCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ping")
    .description("Test connectivity to a peer node")
    .argument("<name>", "Peer node name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const node = getNode(deps.mechaDir, name);
      if (!node) throw new NodeNotFoundError(name);

      if (node.managed) {
        // Managed nodes: check online status via rendezvous server REST API
        const serverUrl = DEFAULTS.RENDEZVOUS_URL.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
        const start = performance.now();
        try {
          const res = await fetch(`${serverUrl}/lookup/${encodeURIComponent(name)}`, {
            signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
          });
          const latencyMs = Math.round(performance.now() - start);
          if (res.ok) {
            const data = await res.json() as { online?: boolean };
            if (data.online) {
              deps.formatter.success(`${name}: ${latencyMs}ms (rendezvous)`);
            } else {
              deps.formatter.error(`${name}: offline (not registered on rendezvous)`);
              process.exitCode = 1;
            }
          } else if (res.status === 404) {
            deps.formatter.error(`${name}: offline (not registered on rendezvous)`);
            process.exitCode = 1;
          } else {
            deps.formatter.error(`${name}: rendezvous lookup failed (HTTP ${res.status})`);
            process.exitCode = 1;
          }
        } catch {
          deps.formatter.error(`${name}: rendezvous server unreachable`);
          process.exitCode = 1;
        }
        return;
      }

      // HTTP-based node: ping via /healthz
      const url = `http://${node.host}:${node.port}/healthz`;
      const start = performance.now();
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
        });
        const latencyMs = Math.round(performance.now() - start);
        if (res.ok) {
          deps.formatter.success(`${name}: ${latencyMs}ms (http)`);
        } else {
          deps.formatter.error(`${name}: HTTP ${res.status}`);
          process.exitCode = 1;
        }
      } catch {
        deps.formatter.error(`${name}: unreachable`);
        process.exitCode = 1;
      }
    }));
}
