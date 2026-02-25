import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS } from "@mecha/core";

export function registerAgentStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Check if the agent server is running")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .action(async (opts: { port: string }) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          deps.formatter.success(`Agent server running on port ${port} (node: ${data.node})`);
        } else {
          deps.formatter.error(`Agent server returned HTTP ${res.status}`);
        }
      } catch {
        deps.formatter.error(`Agent server not reachable on port ${port}`);
      }
    });
}
