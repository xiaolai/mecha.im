import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NodeEntry } from "./node-registry.js";

const execFileAsync = promisify(execFile);

export interface TailscalePeer {
  HostName: string;
  DNSName: string;
  TailscaleIPs: string[];
  Online: boolean;
  OS: string;
}

interface TailscaleStatus {
  Peer?: Record<string, TailscalePeer>;
}

export async function discoverTailscalePeers(): Promise<TailscalePeer[]> {
  const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
  const status = JSON.parse(stdout) as TailscaleStatus;
  if (!status.Peer) return [];
  return Object.values(status.Peer).filter((p) => p.Online);
}

export async function probeMechaAgent(
  host: string,
  port = 7660,
): Promise<{ ok: boolean; node?: string }> {
  const ac = new AbortController();
  /* v8 ignore start -- timeout abort not reachable in unit tests */
  const timer = setTimeout(() => ac.abort(), 3000);
  /* v8 ignore stop */
  try {
    const res = await fetch(`http://${host}:${port}/healthz`, { signal: ac.signal });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { status?: string; node?: string };
    return { ok: body.status === "ok", node: body.node };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverMechaNodes(opts?: { port?: number }): Promise<NodeEntry[]> {
  const peers = await discoverTailscalePeers();
  const port = opts?.port ?? 7660;

  const results = await Promise.all(
    peers.map(async (peer) => {
      const ip = peer.TailscaleIPs[0];
      if (!ip) return null;
      const probe = await probeMechaAgent(ip, port);
      if (!probe.ok) return null;
      // Bracket IPv6 addresses for valid URL formatting
      /* v8 ignore start -- IPv6 branch depends on Tailscale peer addresses */
      const formattedHost = ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`;
      /* v8 ignore stop */
      return {
        name: peer.HostName,
        host: formattedHost,
        key: "", // Key must be provided manually after discovery
      };
    }),
  );

  return results.filter((r): r is NodeEntry => r !== null);
}
