import { execFile } from "node:child_process";
import { createLogger } from "./logger.js";

const log = createLogger("tailscale-scanner");

export interface TailscalePeer {
  ip: string;
  hostname: string;
}

interface TailscaleStatusJson {
  Self?: { TailscaleIPs?: string[]; HostName?: string };
  Peer?: Record<string, {
    TailscaleIPs?: string[];
    HostName?: string;
    Online?: boolean;
    OS?: string;
  }>;
}

/** Parse `tailscale status --json` output. Returns online peers excluding self. */
export function parseTailscaleStatus(json: TailscaleStatusJson): TailscalePeer[] {
  const selfIps = new Set(json.Self?.TailscaleIPs ?? []);
  const peers: TailscalePeer[] = [];

  for (const peer of Object.values(json.Peer ?? {})) {
    if (!peer.Online) continue;
    const ip = peer.TailscaleIPs?.[0];
    if (!ip) continue;
    if (selfIps.has(ip)) continue;
    peers.push({ ip, hostname: peer.HostName ?? ip });
  }

  return peers;
}

/** Run `tailscale status --json` and return online peers. Returns [] on failure. */
export async function scanTailscalePeers(): Promise<TailscalePeer[]> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("tailscale", ["status", "--json"], { timeout: 5_000 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const json = JSON.parse(stdout) as TailscaleStatusJson;
    return parseTailscaleStatus(json);
    /* v8 ignore start -- Tailscale CLI failure */
  } catch (err) {
    log.warn("Tailscale scan failed", { detail: err instanceof Error ? err.message : String(err) });
    return [];
  }
  /* v8 ignore stop */
}
