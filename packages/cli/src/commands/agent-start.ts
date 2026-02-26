import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerAgentStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start the agent server for cross-node communication")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--api-key <key>", "API key for authentication (or set MECHA_AGENT_API_KEY)")
    .option("--host <host>", "Bind address (default: 127.0.0.1)", "127.0.0.1")
    .action(async (opts: { port: string; apiKey?: string; host: string }) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      const apiKey = (opts.apiKey ?? process.env.MECHA_AGENT_API_KEY ?? "").trim();
      if (!apiKey) {
        deps.formatter.error("API key required: use --api-key or set MECHA_AGENT_API_KEY");
        process.exitCode = 1;
        return;
      }

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

      /* v8 ignore start -- shutdown hook only fires on process signal */
      deps.registerShutdownHook?.(() => server.close());
      /* v8 ignore stop */

      const host = opts.host;
      await server.listen({ port, host });
      deps.formatter.success(`Agent server started on ${host}:${port} (node: ${nodeName})`);
    }));
}
