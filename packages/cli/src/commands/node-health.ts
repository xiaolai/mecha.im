import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { readNodes, getNode, NodeNotFoundError, DEFAULTS } from "@mecha/core";

interface HealthResult {
  name: string;
  status: "online" | "offline";
  latencyMs?: number;
  casaCount?: number;
  type: string;
  error?: string;
}

async function checkNodeHealth(
  node: { name: string; host?: string; port?: number; managed?: boolean },
  rendezvousUrl: string,
): Promise<HealthResult> {
  if (node.managed) {
    const serverUrl = rendezvousUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
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

    // Fetch CASA count
    let casaCount: number | undefined;
    try {
      const casaRes = await fetch(`${url}/casas`, {
        headers: { authorization: `Bearer placeholder` },
        signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
      });
      if (casaRes.ok) {
        const casas = await casaRes.json() as unknown[];
        casaCount = casas.length;
      }
    } catch {
      // CASA count is best-effort
    }

    return { name: node.name, status: "online", latencyMs, casaCount, type: "http" };
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
      if (result.casaCount !== undefined) parts.push(`${result.casaCount} CASAs running`);
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

  for (const result of results) {
    if (result.status === "online") {
      const parts = [`${result.name}: ${result.latencyMs}ms`];
      if (result.casaCount !== undefined) parts.push(`${result.casaCount} CASAs running`);
      parts.push(`(${result.type})`);
      deps.formatter.success(parts.join(" — "));
    } else {
      deps.formatter.error(`${result.name}: offline${result.error ? ` — ${result.error}` : ""}`);
    }
  }
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
