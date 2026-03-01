import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { resolveSpaDir } from "../spa-resolve.js";

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

  const apiKey = (process.env.MECHA_AGENT_API_KEY ?? "").trim();
  if (!apiKey) {
    deps.formatter.error("API key required: set MECHA_AGENT_API_KEY");
    process.exitCode = 1;
    return;
  }

  const spaDir = resolveSpaDir();
  if (!spaDir) {
    deps.formatter.error("SPA not found. Run: pnpm --filter @mecha/spa build");
    process.exitCode = 1;
    return;
  }

  const { createAgentServer } = await import("@mecha/agent");
  const { readNodeName } = await import("@mecha/service");
  const { createBunPtySpawn } = await import("@mecha/process");

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
    ptySpawnFn: createBunPtySpawn(),
    spaDir,
  });

  /* v8 ignore start -- shutdown hook only fires on process signal */
  deps.registerShutdownHook?.(() => server.close());
  /* v8 ignore stop */

  await server.listen({ port, host: opts.host });
  deps.formatter.success(`Dashboard started on http://${opts.host}:${port}`);

  /* v8 ignore start -- platform-specific browser open */
  if (opts.open) {
    const { execFile } = await import("node:child_process");
    const url = new URL(`http://${opts.host}:${port}`).href;
    if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url]);
    } else {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      execFile(opener, [url]);
    }
  }
  /* v8 ignore stop */
}

export function registerDashboardServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Dashboard port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .action(async (opts: DashboardServeOpts) => withErrorHandler(deps, () => executeDashboardServe(opts, deps)));
}
