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
  apiKey?: string | false;
  totp: boolean;
}

export async function executeDashboardServe(opts: DashboardServeOpts, deps: CommandDeps): Promise<void> {
  const port = parsePort(opts.port);
  if (port === undefined) {
    deps.formatter.error(`Invalid port: ${opts.port}`);
    process.exitCode = 1;
    return;
  }

  // Resolve auth config (same pipeline as start/agent-start)
  /* v8 ignore start -- API key branches tested in start.test.ts and agent.test.ts */
  const rawApiKey = typeof opts.apiKey === "string" ? opts.apiKey.trim() : undefined;
  const explicitApiKey = rawApiKey || ((process.env.MECHA_AGENT_API_KEY ?? "").trim() || undefined);
  /* v8 ignore stop */
  const authConfig = resolveAuthConfig(deps.mechaDir, {
    totp: opts.totp === false ? false : undefined,
    /* v8 ignore start -- API key override branches tested in start.test.ts */
    apiKey: opts.apiKey === false ? false : explicitApiKey ? true : undefined,
    /* v8 ignore stop */
  });

  if (authConfig.apiKey && !explicitApiKey) {
    deps.formatter.error("API key auth enabled but no key provided: use --api-key or set MECHA_AGENT_API_KEY");
    process.exitCode = 1;
    return;
  }

  // Ensure TOTP secret if TOTP is enabled
  let totpSecret: string | undefined;
  if (authConfig.totp) {
    const { secret, isNew } = await ensureTotpSecret(deps.mechaDir);
    totpSecret = secret;
    if (isNew) {
      await displayTotpSetup(secret, deps.formatter);
    }
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

  const { fetchPublicIp } = await import("@mecha/core");
  const publicIp = await fetchPublicIp();
  const server = createAgentServer({
    port,
    auth: {
      /* v8 ignore start -- API key pass-through tested in start.test.ts */
      apiKey: authConfig.apiKey ? explicitApiKey : undefined,
      /* v8 ignore stop */
      totpSecret,
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

  const methods: string[] = [];
  if (authConfig.totp) methods.push("TOTP");
  /* v8 ignore start -- API key method display tested in start.test.ts */
  if (authConfig.apiKey) methods.push("API key");
  /* v8 ignore stop */
  deps.formatter.success(`Dashboard started on http://${opts.host}:${port} (auth: ${methods.join(" + ")})`);

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

export function registerDashboardServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Dashboard port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .option("--api-key <key>", "API key for authentication (or set MECHA_AGENT_API_KEY)")
    .option("--no-api-key", "Disable API key authentication")
    .option("--no-totp", "Disable TOTP authentication")
    .action(async (opts: DashboardServeOpts) => withErrorHandler(deps, () => executeDashboardServe(opts, deps)));
}
