import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { addNode } from "@mecha/core";
import { DEFAULTS } from "@mecha/core";

export function registerNodeAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Register a peer node")
    .argument("<name>", "Peer node name")
    .argument("<host>", "Peer node hostname or IP")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--api-key <key>", "API key for authentication", "")
    .action((name: string, host: string, opts: { port: string; apiKey: string }) => {
      addNode(deps.mechaDir, {
        name,
        host,
        port: parseInt(opts.port, 10),
        apiKey: opts.apiKey,
        addedAt: new Date().toISOString(),
      });
      deps.formatter.success(`Node added: ${name} (${host}:${opts.port})`);
    });
}
