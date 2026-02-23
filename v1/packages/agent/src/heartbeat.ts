import type { NodeEntry } from "./node-registry.js";

export interface NodeHealth {
  name: string;
  host: string;
  status: "online" | "offline";
  lastSeen: string | null;
  latencyMs: number | null;
  mechaCount: number | null;
}

export interface HeartbeatOptions {
  nodes: () => NodeEntry[];
  intervalMs?: number;
  onUpdate: (health: NodeHealth[]) => void;
}

async function pingNode(entry: NodeEntry): Promise<NodeHealth> {
  const start = Date.now();
  const ac = new AbortController();
  /* v8 ignore start -- timeout abort not reachable in unit tests */
  const timer = setTimeout(() => ac.abort(), 5000);
  /* v8 ignore stop */
  try {
    const url = entry.host.includes("://")
      ? `${entry.host}/healthz`
      : `http://${entry.host}/healthz`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Authorization: `Bearer ${entry.key}` },
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { name: entry.name, host: entry.host, status: "offline", lastSeen: null, latencyMs: null, mechaCount: null };
    }

    const body = (await res.json()) as { mechaCount?: number };
    return {
      name: entry.name,
      host: entry.host,
      status: "online",
      lastSeen: new Date().toISOString(),
      latencyMs,
      mechaCount: body.mechaCount ?? null,
    };
  } catch {
    return { name: entry.name, host: entry.host, status: "offline", lastSeen: null, latencyMs: null, mechaCount: null };
  } finally {
    clearTimeout(timer);
  }
}

export function startHeartbeat(opts: HeartbeatOptions): { stop: () => void } {
  const { nodes, intervalMs = 15_000, onUpdate } = opts;

  async function tick(): Promise<void> {
    const entries = nodes();
    if (entries.length === 0) {
      onUpdate([]);
      return;
    }
    const results = await Promise.all(entries.map(pingNode));
    onUpdate(results);
  }

  /* v8 ignore start -- error swallowing and interval not testable in unit tests */
  tick().catch(() => {});
  const handle = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  /* v8 ignore stop */

  return {
    stop() {
      clearInterval(handle);
    },
  };
}
