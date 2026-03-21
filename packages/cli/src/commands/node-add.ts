import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { addNode, DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'node add' subcommand. */
export function registerNodeAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Register a peer node")
    .argument("<name>", "Peer node name")
    .argument("<host>", "Peer node hostname or IP")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .requiredOption("--api-key <key>", "API key for authentication (required)")
    .action(async (name: string, host: string, opts: { port: string; apiKey: string }) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      addNode(deps.mechaDir, {
        name,
        host,
        port,
        apiKey: opts.apiKey,
        addedAt: new Date().toISOString(),
      });
      deps.formatter.success(`Node added: ${name} (${host}:${opts.port})`);
    }));
}
