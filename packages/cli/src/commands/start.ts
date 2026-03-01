import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { executeDashboardServe } from "./dashboard-serve.js";

interface StartOpts {
  port: string;
  host: string;
  dashboardPort: string;
  open: boolean;
}

export function registerStartCommand(program: Command, deps: CommandDeps): void {
  program
    .command("start")
    .description("Start agent server + dashboard as one daemon")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--dashboard-port <port>", "Dashboard port", String(DEFAULTS.DASHBOARD_PORT))
    .option("--open", "Open browser after starting", false)
    .action(async (opts: StartOpts) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      const dashboardPort = parsePort(opts.dashboardPort);
      if (dashboardPort === undefined) {
        deps.formatter.error(`Invalid dashboard port: ${opts.dashboardPort}`);
        process.exitCode = 1;
        return;
      }

      const apiKey = (process.env.MECHA_AGENT_API_KEY ?? "").trim();
      if (!apiKey) {
        deps.formatter.error("API key required: set MECHA_AGENT_API_KEY");
        process.exitCode = 1;
        return;
      }

      // Start agent server
      const { createAgentServer } = await import("@mecha/agent");
      const { readNodeName } = await import("@mecha/service");

      /* v8 ignore start -- readNodeName returns null only if mesh.json missing */
      const nodeName = readNodeName(deps.mechaDir) ?? "unknown";
      /* v8 ignore stop */
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

      await server.listen({ port, host: opts.host });
      deps.formatter.success(`Agent server started on ${opts.host}:${port} (node: ${nodeName})`);

      // Start dashboard — rollback agent server on failure
      try {
        await executeDashboardServe({
          port: opts.dashboardPort,
          host: opts.host,
          open: opts.open,
          sessionTtl: "24",
        }, deps);
      /* v8 ignore start -- dashboard startup failure rollback */
      } catch (err) {
        await server.close();
        throw err;
      }
      /* v8 ignore stop */
    }));
}
