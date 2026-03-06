import { getNode, NodeNotFoundError, DEFAULTS } from "@mecha/core";

export interface PingResult {
  reachable: boolean;
  latencyMs?: number;
  method: "http" | "rendezvous";
  error?: string;
}

export async function nodePing(
  mechaDir: string,
  name: string,
  opts?: { server?: string },
): Promise<PingResult> {
  const node = getNode(mechaDir, name);
  if (!node) throw new NodeNotFoundError(name);

  if (node.managed) {
    const rendezvousUrl = opts?.server ?? DEFAULTS.RENDEZVOUS_URL;
    const serverUrl = rendezvousUrl
      .replace(/^wss:\/\//, "https://")
      .replace(/^ws:\/\//, "http://");
    const start = performance.now();
    try {
      const res = await fetch(
        `${serverUrl}/lookup/${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS) },
      );
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        const data = (await res.json()) as { online?: boolean };
        return data.online
          ? { reachable: true, latencyMs, method: "rendezvous" }
          : { reachable: false, method: "rendezvous", error: "offline" };
      }
      if (res.status === 404) {
        return { reachable: false, method: "rendezvous", error: "offline" };
      }
      return {
        reachable: false,
        method: "rendezvous",
        error: `HTTP ${res.status}`,
      };
    } catch {
      return {
        reachable: false,
        method: "rendezvous",
        error: "unreachable",
      };
    }
  }

  const url = `http://${node.host}:${node.port}/healthz`;
  const start = performance.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULTS.AGENT_STATUS_TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - start);
    return res.ok
      ? { reachable: true, latencyMs, method: "http" }
      : { reachable: false, method: "http", error: `HTTP ${res.status}` };
  } catch {
    return { reachable: false, method: "http", error: "unreachable" };
  }
}
