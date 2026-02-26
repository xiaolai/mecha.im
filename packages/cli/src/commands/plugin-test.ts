import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { getPlugin, PluginNotFoundError, resolveEnvVars, PluginEnvError } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/* v8 ignore start -- HTTP connectivity test requires a live MCP server */
async function testHttpPlugin(
  name: string,
  url: string,
  headers: Record<string, string> | undefined,
  deps: CommandDeps,
): Promise<void> {
  deps.formatter.info(`Testing ${name} at ${url}...`);
  const start = Date.now();
  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mecha-test", version: "0.1.0" },
        },
        id: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!initRes.ok) {
      deps.formatter.error(`${name}: initialize failed — HTTP ${initRes.status}`);
      process.exitCode = 1;
      return;
    }

    const toolsRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 2,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - start;
    if (!toolsRes.ok) {
      deps.formatter.warn(`${name}: reachable but tools/list failed — HTTP ${toolsRes.status} (${latency}ms)`);
      return;
    }
    const body = (await toolsRes.json()) as { result?: { tools?: unknown[] } };
    const toolCount = body.result?.tools?.length ?? 0;
    deps.formatter.success(`${name}: reachable (${latency}ms, ${toolCount} tools)`);
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    deps.formatter.error(`${name}: unreachable (${latency}ms) — ${msg}`);
    process.exitCode = 1;
  }
}
/* v8 ignore stop */

export function registerPluginTestCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("test")
    .description("Test plugin connectivity (HTTP) or validate config (stdio)")
    .argument("<name>", "Plugin name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const config = getPlugin(deps.mechaDir, name);
      if (!config) throw new PluginNotFoundError(name);

      if (config.type === "stdio") {
        try {
          if (config.env) resolveEnvVars(config.env);
        } catch (err) {
          /* v8 ignore start -- non-PluginEnvError rethrow guard */
          if (!(err instanceof PluginEnvError)) throw err;
          /* v8 ignore stop */
          deps.formatter.error(`${name}: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        deps.formatter.info(`${name}: stdio plugin config valid (command: ${config.command})`);
        deps.formatter.info(`  Run "mecha spawn <casa> <workspace> --expose ${name}" to use`);
        return;
      }

      await testHttpPlugin(name, config.url, config.headers, deps);
    }));
}
