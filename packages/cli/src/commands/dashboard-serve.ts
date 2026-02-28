import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

interface DashboardServeOpts {
  port: string;
  host: string;
  open: boolean;
}

export async function executeDashboardServe(opts: DashboardServeOpts, deps: CommandDeps): Promise<void> {
  const port = parsePort(opts.port);
  if (port === undefined) {
    deps.formatter.error(`Invalid port: ${opts.port}`);
    process.exitCode = 1;
    return;
  }

  const { startDashboard } = await import("@mecha/dashboard");

  const shutdown = await startDashboard({
    port,
    host: opts.host,
    processManager: deps.processManager,
    mechaDir: deps.mechaDir,
    acl: deps.acl,
  });
  deps.registerShutdownHook?.(shutdown);

  deps.formatter.success(`Dashboard started on http://${opts.host}:${port}`);

  if (opts.open) {
    openBrowser(opts.host, port, deps);
  }
}

/* v8 ignore start -- platform-specific browser open */
function openBrowser(host: string, port: number, deps: CommandDeps): void {
  import("node:child_process").then(({ execFile }) => {
    const url = new URL(`http://${host}:${port}`).href;
    const opener = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start"
      : "xdg-open";
    execFile(opener, [url], (err) => {
      if (err) deps.formatter.warn?.(`Failed to open browser: ${err.message}`);
    });
  });
}
/* v8 ignore stop */

export function registerDashboardServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Dashboard port", String(DEFAULTS.DASHBOARD_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .action(async (opts: DashboardServeOpts) => withErrorHandler(deps, () => executeDashboardServe(opts, deps)));
}
