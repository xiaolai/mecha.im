import { hostname, platform, arch, totalmem, freemem, cpus, networkInterfaces } from "node:os";

/** System information and network addresses for a mecha node. */
export interface NodeInfo {
  hostname: string;
  platform: string;
  arch: string;
  port: number;
  uptimeSeconds: number;
  startedAt: string;
  botCount: number;
  totalMemMB: number;
  freeMemMB: number;
  cpuCount: number;
  lanIp?: string;
  tailscaleIp?: string;
  publicIp?: string;
}

const PRIVATE_RANGES = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
const TAILSCALE_RANGE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** Detect the first LAN and Tailscale IPv4 addresses from network interfaces. */
export function getNetworkIps(): { lanIp?: string; tailscaleIp?: string } {
  let lanIp: string | undefined;
  let tailscaleIp: string | undefined;

  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (!tailscaleIp && TAILSCALE_RANGE.test(addr.address)) {
        tailscaleIp = addr.address;
      } else if (!lanIp && PRIVATE_RANGES.some((r) => r.test(addr.address))) {
        lanIp = addr.address;
      }
    }
  }
  return { lanIp, tailscaleIp };
}

const PUBLIC_IP_PROVIDERS = [
  "https://ifconfig.me/ip",
  "https://api.ipify.org",
];

/** Fetch the node's public IP address from external services. Returns undefined on failure. */
export async function fetchPublicIp(): Promise<string | undefined> {
  for (const url of PUBLIC_IP_PROVIDERS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) continue;
      const text = await res.text();
      const ip = text.trim();
      if (ip) return ip;
    /* v8 ignore start -- network failure fallback */
    } catch {
      continue;
    }
    /* v8 ignore stop */
  }
  return undefined;
}

/** Collect comprehensive node system info including CPU, memory, and network addresses. */
export function collectNodeInfo(opts: {
  port: number;
  startedAt: string;
  botCount: number;
  publicIp?: string;
}): NodeInfo {
  const { lanIp, tailscaleIp } = getNetworkIps();
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    port: opts.port,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: opts.startedAt,
    botCount: opts.botCount,
    totalMemMB: Math.round(totalmem() / (1024 * 1024)),
    freeMemMB: Math.round(freemem() / (1024 * 1024)),
    cpuCount: cpus().length,
    lanIp,
    tailscaleIp,
    publicIp: opts.publicIp,
  };
}

/** Convert ws:// or wss:// URL to http:// or https:// for REST calls. */
export function wsToHttp(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

/** Format seconds into a human-readable uptime string (e.g. "2d 5h", "3h 12m"). */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
