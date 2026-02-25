import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";

export function registerAgentStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start the agent server for cross-node communication")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .requiredOption("--api-key <key>", "API key for authentication (required)")
    .action(async (opts: { port: string; apiKey: string }) => {
      const port = parsePort(opts.port);
      if (port === undefined) {
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

      /* v8 ignore start -- signal handlers only fire in real process */
      const shutdown = async () => { await server.close(); };
      /* v8 ignore stop */
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);

      await server.listen({ port, host: "0.0.0.0" });
      deps.formatter.success(`Agent server started on port ${port} (node: ${nodeName})`);
    });
}
