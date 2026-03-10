import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort, resolveAuthConfig, ensureTotpSecret } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { resolveSpaDir } from "../spa-resolve.js";
import { displayTotpSetup } from "../totp-display.js";

interface DashboardServeOpts {
  port: string;
  host: string;
  open: boolean;
}

/** Execute the dashboard serve logic (start Fastify server). */
export async function executeDashboardServe(opts: DashboardServeOpts, deps: CommandDeps): Promise<void> {
  const port = parsePort(opts.port);
  if (port === undefined) {
    deps.formatter.error(`Invalid port: ${opts.port}`);
    process.exitCode = 1;
    return;
  }

  // Resolve auth config (TOTP is always required)
  const authConfig = resolveAuthConfig(deps.mechaDir);

  // Ensure TOTP secret if TOTP is enabled
  let totpSecret: string | undefined;
  if (authConfig.totp) {
    const { secret, isNew } = await ensureTotpSecret(deps.mechaDir);
    totpSecret = secret;
    if (isNew) {
      await displayTotpSetup(secret, deps.formatter);
    }
  }

  const spaDir = await resolveSpaDir();
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

  const { fetchPublicIp } = await import("@mecha/core");
  const publicIp = await fetchPublicIp();
  // Derive internal mesh routing key from TOTP secret (not user-facing)
  /* v8 ignore start -- mesh key derivation requires TOTP secret */
  const { createHmac } = await import("node:crypto");
  const meshKey = totpSecret
    ? createHmac("sha256", totpSecret).update("mecha-mesh-routing").digest("hex")
    : undefined;
  /* v8 ignore stop */

  const server = createAgentServer({
    port,
    auth: {
      totpSecret,
      apiKey: meshKey,
    },
    processManager: deps.processManager,
    acl: deps.acl,
    mechaDir: deps.mechaDir,
    nodeName,
    startedAt: new Date().toISOString(),
    publicIp,
    ptySpawnFn: createBunPtySpawn(),
    spaDir,
  });

  /* v8 ignore start -- shutdown hook only fires on process signal */
  deps.registerShutdownHook?.(() => server.close());
  /* v8 ignore stop */

  await server.listen({ port, host: opts.host });

  deps.formatter.success(`Dashboard started on http://${opts.host}:${port} (auth: TOTP)`);

  /* v8 ignore start -- platform-specific browser open */
  if (opts.open) {
    const { execFile } = await import("node:child_process");
    const hostPart = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
    const url = new URL(`http://${hostPart}:${port}`).href;
    const onError = (err: Error | null) => { if (err) deps.formatter.warn(`Failed to open browser: ${err.message}`); };
    if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], onError);
    } else {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      execFile(opener, [url], onError);
    }
  }
  /* v8 ignore stop */
}

/** Register the 'dashboard serve' subcommand. */
export function registerDashboardServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Dashboard port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .action(async (opts: DashboardServeOpts) => withErrorHandler(deps, () => executeDashboardServe(opts, deps)));
}
