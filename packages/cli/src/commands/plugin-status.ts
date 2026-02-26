import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { getPlugin, PluginNotFoundError } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/* v8 ignore start -- HTTP reachability check requires a live MCP server */
async function checkHttpPlugin(
  name: string,
  url: string,
  headers: Record<string, string> | undefined,
  deps: CommandDeps,
): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      deps.formatter.success(`${name}: reachable (${latency}ms)`);
    } else {
      deps.formatter.error(`${name}: HTTP ${res.status} (${latency}ms)`);
      process.exitCode = 1;
    }
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    deps.formatter.error(`${name}: unreachable (${latency}ms) — ${msg}`);
    process.exitCode = 1;
  }
}
/* v8 ignore stop */

export function registerPluginStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Check if a plugin is reachable")
    .argument("<name>", "Plugin name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const config = getPlugin(deps.mechaDir, name);
      if (!config) throw new PluginNotFoundError(name);

      if (config.type === "stdio") {
        deps.formatter.info(`${name}: stdio plugin (command: ${config.command}) — use "plugin test" to verify`);
        return;
      }

      await checkHttpPlugin(name, config.url, config.headers, deps);
    }));
}
