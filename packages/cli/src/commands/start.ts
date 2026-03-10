import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort, resolveAuthConfig, ensureTotpSecret } from "@mecha/core";
import { writeFileSync, unlinkSync, existsSync, realpathSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";
import { resolveSpaDir } from "../spa-resolve.js";
import { displayTotpSetup } from "../totp-display.js";
import { readDaemonPid, writeDaemonPid, removeDaemonPid, isDaemonRunning } from "../daemon.js";

interface StartOpts {
  port: string;
  host: string;
  open: boolean;
  daemon: boolean;
}

/** Register the 'start' command. */
export function registerStartCommand(program: Command, deps: CommandDeps): void {
  program
    .command("start")
    .description("Start Mecha with embedded dashboard")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .option("-d, --daemon", "Run in background", false)
    .action(async (opts: StartOpts) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }

      /* v8 ignore start -- daemon fork is a process-level concern */
      if (opts.daemon) {
        const existingPid = readDaemonPid(deps.mechaDir);
        if (existingPid !== null && isDaemonRunning(deps.mechaDir)) {
          deps.formatter.error(`Daemon already running (pid ${existingPid})`);
          process.exitCode = 1;
          return;
        }

        const { spawn } = await import("node:child_process");
        // In Bun compiled binaries, process.argv contains VFS paths (/$bunfs/...) that
        // must be stripped. Filter them out, then remove the daemon flag.
        const filteredArgs = process.argv
          .filter((a) => !a.startsWith("/$bunfs/"))
          .slice(1)
          .filter((a) => a !== "-d" && a !== "--daemon");
        // Resolve the real binary path — process.execPath returns VFS paths in Bun compiled binaries
        let selfBin = process.execPath;
        if (existsSync("/proc/self/exe")) {
          try { selfBin = realpathSync("/proc/self/exe"); } catch { /* keep process.execPath */ }
        }
        // Load .env from mechaDir so daemon inherits API keys etc.
        // Simple parser: KEY=value with optional surrounding quotes. Does not
        // handle escaped quotes, multi-line values, or `export` prefix.
        const envFile = join(deps.mechaDir, ".env");
        const daemonEnv = { ...process.env };
        if (existsSync(envFile)) {
          for (const line of readFileSync(envFile, "utf-8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eq = trimmed.indexOf("=");
            if (eq <= 0) continue;
            const key = trimmed.slice(0, eq);
            let val = trimmed.slice(eq + 1);
            // Strip surrounding quotes
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            daemonEnv[key] = val;
          }
        }
        const child = spawn(selfBin, filteredArgs, {
          detached: true,
          stdio: "ignore",
          env: daemonEnv,
        });
        if (!child.pid) {
          deps.formatter.error("Failed to fork daemon process");
          process.exitCode = 1;
          return;
        }
        const childPid = child.pid;
        child.unref();
        writeDaemonPid(deps.mechaDir, childPid);
        deps.formatter.success(`Mecha started in background (pid ${childPid})`);
        return;
      }
      /* v8 ignore stop */

      // Resolve auth config from file (TOTP is always required)
      const authConfig = resolveAuthConfig(deps.mechaDir);

      // Ensure TOTP secret exists if TOTP is enabled
      let totpSecret: string | undefined;
      if (authConfig.totp) {
        const { secret, isNew } = await ensureTotpSecret(deps.mechaDir);
        totpSecret = secret;
        if (isNew) {
          await displayTotpSetup(secret, deps.formatter);
        }
      }

      // Start agent server
      const { createAgentServer } = await import("@mecha/agent");
      const { ensureNodeName } = await import("@mecha/service");
      const { createBunPtySpawn } = await import("@mecha/process");

      /* v8 ignore start -- auto-init node name from hostname if not set */
      const nodeName = ensureNodeName(deps.mechaDir);
      /* v8 ignore stop */

      const spaDir = await resolveSpaDir();
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
      deps.registerShutdownHook?.(async () => removeDaemonPid(deps.mechaDir));
      /* v8 ignore stop */

      await server.listen({ port, host: opts.host });
      // Foreground mode: write daemon.pid so `mecha stop` can find us
      writeDaemonPid(deps.mechaDir, process.pid);

      // Write agent discovery file for CLI client commands (includes host for remote binding)
      const agentInfoPath = join(deps.mechaDir, "agent.json");
      writeFileSync(agentInfoPath, JSON.stringify({ port, host: opts.host, pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
      /* v8 ignore start -- shutdown cleanup only fires on process signal */
      deps.registerShutdownHook?.(async () => {
        try { unlinkSync(agentInfoPath); } catch { /* already removed */ }
      });
      /* v8 ignore stop */

      // Auto-start meter daemon in-process
      /* v8 ignore start -- meter auto-start is best-effort */
      try {
        const { startMeterDaemon } = await import("@mecha/agent");
        const handle = await startMeterDaemon(deps.mechaDir);
        deps.registerShutdownHook?.(() => handle.close());
        deps.formatter.success(`Meter proxy started on 127.0.0.1:${handle.info.port}`);
      } catch (err) {
        deps.formatter.warn(`Meter auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      /* v8 ignore stop */

      // Auto-start MCP server in-process
      /* v8 ignore start -- MCP auto-start is best-effort */
      try {
        const { startHttpDaemon, createMeshMcpServer, createAuditLog, createRateLimiter } = await import("@mecha/mcp-server");
        const { agentFetch } = await import("@mecha/service");
        const { readNodes } = await import("@mecha/core");

        const mcpHandle = await startHttpDaemon(
          () => createMeshMcpServer({
            mechaDir: deps.mechaDir,
            pm: deps.processManager,
            getNodes: () => readNodes(deps.mechaDir),
            agentFetch,
            mode: "query",
            audit: createAuditLog(deps.mechaDir),
            rateLimiter: createRateLimiter(),
          }),
          { port: 7680, host: "127.0.0.1" },
        );
        deps.registerShutdownHook?.(() => mcpHandle.close());
        deps.formatter.success(`MCP server started on http://127.0.0.1:${mcpHandle.port}/mcp`);
      } catch (err) {
        deps.formatter.warn(`MCP auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      /* v8 ignore stop */

      /* v8 ignore start -- SPA presence varies by build configuration */
      if (spaDir) {
        deps.formatter.success(`Mecha started on http://${opts.host}:${port} (node: ${nodeName}, auth: TOTP)`);
      } else {
        deps.formatter.success(`Agent server started on ${opts.host}:${port} (node: ${nodeName}, auth: TOTP)`);
        deps.formatter.warn("SPA not found — dashboard not available. Run pnpm --filter @mecha/spa build");
      }
      /* v8 ignore stop */

      /* v8 ignore start -- browser open is platform-specific */
      if (opts.open && spaDir) {
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
    }));
}
