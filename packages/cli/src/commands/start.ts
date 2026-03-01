import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { resolveSpaDir } from "../spa-resolve.js";

interface StartOpts {
  port: string;
  host: string;
  open: boolean;
}

export function registerStartCommand(program: Command, deps: CommandDeps): void {
  program
    .command("start")
    .description("Start agent server with embedded dashboard")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--open", "Open browser after starting", false)
    .action(async (opts: StartOpts) => withErrorHandler(deps, async () => {
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

      // Start agent server
      const { createAgentServer } = await import("@mecha/agent");
      const { readNodeName } = await import("@mecha/service");
      const { createBunPtySpawn } = await import("@mecha/process");

      /* v8 ignore start -- readNodeName returns null only if mesh.json missing */
      const nodeName = readNodeName(deps.mechaDir) ?? "unknown";
      /* v8 ignore stop */

      const spaDir = resolveSpaDir();
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

      if (spaDir) {
        deps.formatter.success(`Mecha started on http://${opts.host}:${port} (node: ${nodeName})`);
      } else {
        deps.formatter.success(`Agent server started on ${opts.host}:${port} (node: ${nodeName})`);
        deps.formatter.warn?.("SPA not found — dashboard not available. Run pnpm --filter @mecha/spa build");
      }

      /* v8 ignore start -- browser open is platform-specific */
      if (opts.open && spaDir) {
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
    }));
}
