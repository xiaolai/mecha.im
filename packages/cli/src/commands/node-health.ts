import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { readNodes, getNode, NodeNotFoundError, DEFAULTS } from "@mecha/core";

interface HealthResult {
  name: string;
  status: "online" | "offline";
  latencyMs?: number;
  botCount?: number;
  type: string;
  error?: string;
}

async function checkNodeHealth(
  node: { name: string; host?: string; port?: number; managed?: boolean; serverUrl?: string; apiKey?: string },
  rendezvousUrl: string,
): Promise<HealthResult> {
  if (node.managed) {
    // Use per-node server URL if available, fall back to global rendezvous URL
    const rvUrl = node.serverUrl ?? rendezvousUrl;
    const serverUrl = rvUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const start = performance.now();
    try {
      const res = await fetch(`${serverUrl}/lookup/${encodeURIComponent(node.name)}`, {
        signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
      });
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json() as { online?: boolean };
        return data.online
          ? { name: node.name, status: "online", latencyMs, type: "managed" }
          : { name: node.name, status: "offline", type: "managed" };
      }
      return { name: node.name, status: "offline", type: "managed" };
    } catch {
      return { name: node.name, status: "offline", type: "managed", error: "unreachable" };
    }
  }

  const url = `http://${node.host}:${node.port}`;
  const start = performance.now();
  try {
    const healthRes = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!healthRes.ok) {
      return { name: node.name, status: "offline", type: "http", error: `HTTP ${healthRes.status}` };
    }

    // Fetch bot count
    let botCount: number | undefined;
    try {
      const botRes = await fetch(`${url}/bots`, {
        ...(node.apiKey && { headers: { authorization: `Bearer ${node.apiKey}` } }),
        signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
      });
      if (botRes.ok) {
        const bots = await botRes.json() as unknown[];
        botCount = bots.length;
      }
    } catch {
      // bot count is best-effort
    }

    return { name: node.name, status: "online", latencyMs, botCount, type: "http" };
  } catch {
    return { name: node.name, status: "offline", type: "http", error: "unreachable" };
  }
}

export async function executeNodeHealth(name: string | undefined, deps: CommandDeps): Promise<void> {
  if (name) {
    const node = getNode(deps.mechaDir, name);
    if (!node) throw new NodeNotFoundError(name);

    const result = await checkNodeHealth(node, DEFAULTS.RENDEZVOUS_URL);
    if (result.status === "online") {
      const parts = [`${result.name}: ${result.latencyMs}ms`];
      if (result.botCount !== undefined) parts.push(`${result.botCount} bots running`);
      parts.push(`(${result.type})`);
      deps.formatter.success(parts.join(" — "));
    } else {
      deps.formatter.error(`${result.name}: offline${result.error ? ` — ${result.error}` : ""}`);
      process.exitCode = 1;
    }
    return;
  }

  // All nodes
  const nodes = readNodes(deps.mechaDir);
  if (nodes.length === 0) {
    deps.formatter.info("No remote nodes configured");
    return;
  }

  const results = await Promise.all(
    nodes.map((n) => checkNodeHealth(n, DEFAULTS.RENDEZVOUS_URL)),
  );

  let hasFailure = false;
  for (const result of results) {
    if (result.status === "online") {
      const parts = [`${result.name}: ${result.latencyMs}ms`];
      if (result.botCount !== undefined) parts.push(`${result.botCount} bots running`);
      parts.push(`(${result.type})`);
      deps.formatter.success(parts.join(" — "));
    } else {
      deps.formatter.error(`${result.name}: offline${result.error ? ` — ${result.error}` : ""}`);
      hasFailure = true;
    }
  }
  if (hasFailure) process.exitCode = 1;
}

/* v8 ignore start -- commander wiring tested via executeNodeHealth */
export function registerNodeHealthCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("health")
    .description("Check health of mesh nodes")
    .argument("[name]", "Specific node name (omit for all)")
    .action(async (name?: string) => withErrorHandler(deps, () => executeNodeHealth(name, deps)));
}
/* v8 ignore stop */
