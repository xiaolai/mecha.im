import type { FastifyInstance } from "fastify";
import { type NodeEntry, readNodes, collectNodeInfo, createLogger } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { agentFetch } from "@mecha/service";

const log = createLogger("mesh-routes");

export interface MeshRouteOpts {
  mechaDir: string;
  nodeName: string;
  processManager: ProcessManager;
  port: number;
  startedAt: string;
  publicIp?: string;
}

interface NodeStatus {
  name: string;
  status: "online" | "offline";
  isLocal?: boolean;
  latencyMs?: number;
  error?: string;
  casaCount?: number;
  hostname?: string;
  platform?: string;
  arch?: string;
  port?: number;
  uptimeSeconds?: number;
  startedAt?: string;
  totalMemMB?: number;
  freeMemMB?: number;
  cpuCount?: number;
  lanIp?: string;
  tailscaleIp?: string;
  publicIp?: string;
}

const PROXY_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_CHECKS = 10;

/* v8 ignore start -- health check requires live network to remote nodes */
function parseNodeInfoBody(name: string, body: Record<string, unknown>, latencyMs: number): NodeStatus {
  return {
    name,
    status: "online",
    latencyMs,
    casaCount: typeof body.casaCount === "number" ? body.casaCount : undefined,
    hostname: typeof body.hostname === "string" ? body.hostname : undefined,
    platform: typeof body.platform === "string" ? body.platform : undefined,
    arch: typeof body.arch === "string" ? body.arch : undefined,
    port: typeof body.port === "number" ? body.port : undefined,
    uptimeSeconds: typeof body.uptimeSeconds === "number" ? body.uptimeSeconds : undefined,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
    totalMemMB: typeof body.totalMemMB === "number" ? body.totalMemMB : undefined,
    freeMemMB: typeof body.freeMemMB === "number" ? body.freeMemMB : undefined,
    cpuCount: typeof body.cpuCount === "number" ? body.cpuCount : undefined,
    lanIp: typeof body.lanIp === "string" ? body.lanIp : undefined,
    tailscaleIp: typeof body.tailscaleIp === "string" ? body.tailscaleIp : undefined,
    publicIp: typeof body.publicIp === "string" ? body.publicIp : undefined,
  };
}

async function checkNodeHealth(node: NodeEntry): Promise<NodeStatus> {
  const start = performance.now();
  try {
    // Try authenticated /node/info first for rich details
    const res = await agentFetch({
      node,
      path: "/node/info",
      method: "GET",
      timeoutMs: PROXY_TIMEOUT_MS,
    });
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      const body = await res.json() as Record<string, unknown>;
      return parseNodeInfoBody(node.name, body, latencyMs);
    }
    // Fall back to /healthz for basic online check
    if (res.status === 401 || res.status === 404) {
      const hRes = await agentFetch({ node, path: "/healthz", method: "GET", timeoutMs: PROXY_TIMEOUT_MS });
      const hLatencyMs = Math.round(performance.now() - start);
      return hRes.ok
        ? { name: node.name, status: "online", latencyMs: hLatencyMs }
        : { name: node.name, status: "offline", error: `HTTP ${hRes.status}` };
    }
    return { name: node.name, status: "offline", error: `HTTP ${res.status}` };
  } catch (err) {
    return { name: node.name, status: "offline", error: err instanceof Error ? err.message : "unreachable" };
  }
}

async function checkNodesWithConcurrencyLimit(entries: NodeEntry[]): Promise<NodeStatus[]> {
  const results: NodeStatus[] = [];
  for (let i = 0; i < entries.length; i += MAX_CONCURRENT_CHECKS) {
    const batch = entries.slice(i, i + MAX_CONCURRENT_CHECKS);
    const settled = await Promise.allSettled(batch.map((n) => checkNodeHealth(n)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j]!;
      results.push(
        r.status === "fulfilled"
          ? r.value
          : { name: batch[j]!.name, status: "offline" as const, error: "check failed" },
      );
    }
  }
  return results;
}
/* v8 ignore stop */

export function registerMeshRoutes(app: FastifyInstance, opts: MeshRouteOpts): void {
  app.get("/mesh/nodes", async () => {
    // Local node: collect full system info (only running CASAs)
    const info = collectNodeInfo({
      port: opts.port,
      startedAt: opts.startedAt,
      casaCount: opts.processManager.list().filter((p) => p.state === "running").length,
      publicIp: opts.publicIp,
    });

    const localNode: NodeStatus = {
      name: opts.nodeName,
      status: "online",
      isLocal: true,
      latencyMs: 0,
      ...info,
    };

    let entries: NodeEntry[];
    try {
      entries = readNodes(opts.mechaDir);
    /* v8 ignore start -- no nodes.json file */
    } catch (err) {
      log.warn("Failed to read nodes.json", { detail: err instanceof Error ? err.message : String(err) });
      return [localNode];
    }
    /* v8 ignore stop */

    /* v8 ignore start -- health check requires live network to remote nodes */
    const remoteNodes = await checkNodesWithConcurrencyLimit(entries);
    return [localNode, ...remoteNodes];
    /* v8 ignore stop */
  });
}
