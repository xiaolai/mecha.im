import type { FastifyInstance } from "fastify";
import { type NodeEntry, readNodes } from "@mecha/core";
import { agentFetch } from "@mecha/service";

export interface MeshRouteOpts {
  mechaDir: string;
}

interface NodeStatus {
  name: string;
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
}

const PROXY_TIMEOUT_MS = 5_000;

/* v8 ignore start -- health check requires live network to remote nodes */
async function checkNodeHealth(node: NodeEntry): Promise<NodeStatus> {
  const start = performance.now();
  try {
    const res = await agentFetch({
      node,
      path: "/healthz",
      method: "GET",
      timeoutMs: PROXY_TIMEOUT_MS,
    });
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      return { name: node.name, status: "online", latencyMs };
    }
    return { name: node.name, status: "offline", error: `HTTP ${res.status}` };
  } catch (err) {
    return { name: node.name, status: "offline", error: err instanceof Error ? err.message : "unreachable" };
  }
}
/* v8 ignore stop */

export function registerMeshRoutes(app: FastifyInstance, opts: MeshRouteOpts): void {
  app.get("/mesh/nodes", async () => {
    let entries: NodeEntry[];
    try {
      entries = readNodes(opts.mechaDir);
    /* v8 ignore start -- no nodes.json file */
    } catch {
      return [];
    }
    /* v8 ignore stop */

    /* v8 ignore start -- health check requires live network to remote nodes */
    const results = await Promise.allSettled(
      entries.map((n) => checkNodeHealth(n)),
    );

    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { name: entries[i]!.name, status: "offline" as const, error: "check failed" },
    );
    /* v8 ignore stop */
  });
}
