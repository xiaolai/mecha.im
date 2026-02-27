import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

interface DashboardServeOpts {
  port: string;
  host: string;
  open: boolean;
}

export function registerDashboardServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Dashboard port", String(DEFAULTS.DASHBOARD_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .action(async (opts: DashboardServeOpts) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }

      const { startDashboard } = await import("@mecha/dashboard");

      /* v8 ignore start -- shutdown hook only fires on process signal */
      const shutdown = await startDashboard({
        port,
        host: opts.host,
        processManager: deps.processManager,
        mechaDir: deps.mechaDir,
        acl: deps.acl,
      });
      deps.registerShutdownHook?.(shutdown);
      /* v8 ignore stop */

      deps.formatter.success(`Dashboard started on http://${opts.host}:${port}`);

      /* v8 ignore start -- browser open only in interactive mode */
      if (opts.open) {
        const { exec } = await import("node:child_process");
        const url = `http://${opts.host}:${port}`;
        const cmd = process.platform === "darwin" ? `open ${url}`
          : process.platform === "win32" ? `start ${url}`
          : `xdg-open ${url}`;
        exec(cmd);
      }
      /* v8 ignore stop */
    }));
}
