import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS } from "@mecha/core";

export function registerAgentStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start the agent server for cross-node communication")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .requiredOption("--api-key <key>", "API key for authentication (required)")
    .action(async (opts: { port: string; apiKey: string }) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        return;
      }
      const apiKey = opts.apiKey;

      // Lazy import to avoid pulling in fastify when not needed
      const { createAgentServer } = await import("@mecha/agent");
      const { readNodeName } = await import("@mecha/service");

      const nodeName = readNodeName(deps.mechaDir) ?? "unknown";
      const server = createAgentServer({
        port,
        apiKey,
        processManager: deps.processManager,
        acl: deps.acl,
        mechaDir: deps.mechaDir,
        nodeName,
      });

      await server.listen({ port, host: "0.0.0.0" });
      deps.formatter.success(`Agent server started on port ${port} (node: ${nodeName})`);
    });
}
