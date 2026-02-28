import type { ProcessManager, ProcessInfo } from "@mecha/process";
import { type NodeEntry, readNodes, DEFAULTS } from "@mecha/core";
import { agentFetch } from "@mecha/service";

export interface NodeStatus {
  name: string;
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
  casaCount?: number;
}

export interface CasaWithNode {
  name: string;
  node: string;
  state: string;
  port?: number;
  workspacePath?: string;
}

const PROXY_TIMEOUT_MS = 5_000;

export async function proxyToNode(
  node: NodeEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return agentFetch({
    node,
    path,
    method,
    body,
    timeoutMs: PROXY_TIMEOUT_MS,
  });
}

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

export async function fetchAllNodes(mechaDir: string): Promise<{ nodes: NodeStatus[] }> {
  let entries: NodeEntry[];
  try {
    entries = readNodes(mechaDir);
  } catch (err) {
    console.warn("[mesh-proxy] readNodes failed:", err instanceof Error ? err.message : String(err));
    return { nodes: [] };
  }

  const results = await Promise.allSettled(
    entries.map((n) => checkNodeHealth(n)),
  );

  /* v8 ignore start -- checkNodeHealth catches all errors internally */
  const nodes: NodeStatus[] = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { name: entries[i].name, status: "offline" as const, error: "check failed" },
  );
  /* v8 ignore stop */

  return { nodes };
}

export async function fetchAllCasas(
  pm: ProcessManager,
  mechaDir: string,
): Promise<{ casas: CasaWithNode[]; nodeStatus: Record<string, NodeStatus> }> {
  // Local CASAs
  const localList = pm.list();
  const localCasas: CasaWithNode[] = localList.map((p: ProcessInfo) => ({
    name: p.name,
    node: "local",
    state: p.state,
    port: p.port,
    workspacePath: p.workspacePath,
  }));

  const nodeStatus: Record<string, NodeStatus> = {
    local: { name: "local", status: "online" },
  };

  // Remote nodes
  let entries: NodeEntry[];
  try {
    entries = readNodes(mechaDir);
  } catch (err) {
    console.warn("[mesh-proxy] readNodes failed:", err instanceof Error ? err.message : String(err));
    return { casas: localCasas, nodeStatus };
  }

  const results = await Promise.allSettled(
    entries.map(async (node) => {
      const health = await checkNodeHealth(node);
      nodeStatus[node.name] = health;

      if (health.status !== "online") return [];

      try {
        const res = await agentFetch({
          node,
          path: "/casas",
          method: "GET",
          timeoutMs: PROXY_TIMEOUT_MS,
        });
        if (!res.ok) return [];
        const casas = await res.json() as Array<{ name: string; state: string; port?: number }>;
        return casas.map((c) => ({
          name: c.name,
          node: node.name,
          state: c.state,
          port: c.port,
        }));
      } catch {
        return [];
      }
    }),
  );

  const remoteCasas: CasaWithNode[] = results.flatMap((r) =>
    /* v8 ignore start -- inner async catches all errors */
    r.status === "fulfilled" ? r.value : [],
    /* v8 ignore stop */
  );

  return {
    casas: [...localCasas, ...remoteCasas],
    nodeStatus,
  };
}
