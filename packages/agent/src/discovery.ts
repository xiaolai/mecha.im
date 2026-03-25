/**
 * Periodic peer auto-discovery via Tailscale and mDNS (LAN fallback).
 *
 * Scans for online Tailscale peers and mDNS-advertised Mecha agents,
 * probes their healthz endpoint, and writes newly found peers to
 * the discovered-nodes registry.
 * Expired entries (not seen for 24 hours) are cleaned up each cycle.
 */
import {
  createLogger,
  scanTailscalePeers,
  readNodes,
  readDiscoveredNodes,
  writeDiscoveredNode,
  cleanupExpiredNodes,
  refreshDiscoveredNodes,
} from "@mecha/core";
import type { DiscoveredNode } from "@mecha/core";
import { networkInterfaces } from "node:os";
import { Bonjour } from "bonjour-service";
import type { Service } from "bonjour-service";

const log = createLogger("mecha:discovery");

/** Default agent port to probe on discovered peers. */
const AGENT_PORT = 7660;

/** How long a discovered node may go unseen before being removed (24 hours). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Interval between discovery scans (60 seconds). */
export const SCAN_INTERVAL_MS = 60_000;

/** mDNS browse timeout in milliseconds. */
export const MDNS_BROWSE_TIMEOUT_MS = 3_000;

// ── mDNS advertise / browse ────────────────────────────────────────

/** Options for starting the mDNS service advertiser. */
export interface MdnsAdvertiseOpts {
  nodeName: string;
  port: number;
  version: string;
}

/**
 * Advertise this agent on the LAN via mDNS so that peers can discover it.
 * Returns a cleanup function that stops advertising and destroys the Bonjour instance.
 *
 * NOTE: The mesh API key is NOT placed in TXT records. Key exchange happens
 * during the authenticated healthz probe (already implemented).
 */
export function startMdnsAdvertise(opts: MdnsAdvertiseOpts): () => void {
  try {
    const bonjour = new Bonjour();
    const service = bonjour.publish({
      name: `mecha-${opts.nodeName}`,
      type: "mecha",
      port: opts.port,
      txt: {
        nodeName: opts.nodeName,
        version: opts.version,
      },
    });
    // Attach error handler so async mDNS errors don't crash the process
    service.on?.("error", (err: Error) => {
      log.warn("mDNS advertise error", { error: err.message });
    });
    log.info("mDNS service advertised", { name: opts.nodeName, port: opts.port });
    return () => {
      // Wait for goodbye packet before destroying the instance
      if (service.stop) {
        service.stop(() => { bonjour.destroy(); });
      } else {
        /* v8 ignore start -- defensive fallback */
        bonjour.destroy();
        /* v8 ignore stop */
      }
    };
  /* v8 ignore start -- port 5353 may be in use */
  } catch (err) {
    log.warn("mDNS advertise failed — port 5353 may be in use", {
      detail: err instanceof Error ? err.message : String(err),
    });
    return () => {};
  }
  /* v8 ignore stop */
}

/** A peer discovered via mDNS on the LAN. */
export interface MdnsPeer {
  ip: string;
  hostname: string;
  port: number;
}

/**
 * Browse the LAN for mDNS-advertised Mecha agents.
 * Resolves early (after a {@link MDNS_DEBOUNCE_MS} debounce) once the first
 * peer responds, or after {@link MDNS_BROWSE_TIMEOUT_MS} if none respond.
 * Each scan creates a fresh Bonjour instance and destroys it on completion.
 */

/** Minimum wait after first mDNS response before resolving (debounce). */
export const MDNS_DEBOUNCE_MS = 500;

export async function scanMdnsPeers(): Promise<MdnsPeer[]> {
  return new Promise((resolve) => {
    try {
      const bonjour = new Bonjour();
      const peers: MdnsPeer[] = [];
      let resolved = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        browser.stop();
        bonjour.destroy();
        resolve(peers);
      };

      const browser = bonjour.find({ type: "mecha" });

      // Attach error handler so async browse errors don't crash the process
      browser.on?.("error", () => { /* ignore browse errors */ });

      browser.on("up", (service: Service) => {
        const ip = service.addresses?.find((a: string) => !a.includes(":")) ?? service.host;
        if (ip) {
          peers.push({
            ip,
            hostname: service.txt?.nodeName ?? service.name.replace(/^mecha-/, ""),
            port: service.port,
          });
        }
        // After first response, start a short debounce to collect stragglers
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(finish, MDNS_DEBOUNCE_MS);
      });

      // Hard timeout — resolve regardless
      setTimeout(finish, MDNS_BROWSE_TIMEOUT_MS);
    /* v8 ignore start -- mDNS bind failure */
    } catch (err) {
      log.warn("mDNS scan failed", {
        detail: err instanceof Error ? err.message : String(err),
      });
      resolve([]);
    }
    /* v8 ignore stop */
  });
}

// ── Discovery scan ─────────────────────────────────────────────────

/**
 * Run a single discovery scan:
 * 1. Scan Tailscale for online peers
 * 2. Scan mDNS for LAN peers (fallback)
 * 3. Merge and deduplicate by IP (Tailscale takes precedence)
 * 4. Probe each unknown peer's healthz
 * 5. Register newly found Mecha agents in the discovered registry
 * 6. Refresh lastSeen for already-known peers that are still online
 * 7. Clean up nodes not seen for 24h
 */
export async function runDiscoveryScan(mechaDir: string, meshApiKey: string): Promise<void> {
  // Scan both sources in parallel
  const [tailscalePeers, mdnsPeers] = await Promise.all([
    scanTailscalePeers(),
    scanMdnsPeers(),
  ]);

  // Merge, deduplicate by IP — Tailscale takes precedence
  const allPeers = new Map<string, { ip: string; hostname: string; port: number; source: "tailscale" | "mdns" }>();
  for (const p of tailscalePeers) {
    allPeers.set(p.ip, { ip: p.ip, hostname: p.hostname, port: AGENT_PORT, source: "tailscale" });
  }
  for (const p of mdnsPeers) {
    if (!allPeers.has(p.ip)) {
      allPeers.set(p.ip, { ip: p.ip, hostname: p.hostname, port: p.port, source: "mdns" });
    }
  }

  // Filter out self-discovery — exclude local IPs to avoid registering ourselves
  const localIps = new Set<string>();
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal) localIps.add(iface.address);
    }
  }
  const peers = [...allPeers.values()].filter((p) => !localIps.has(p.ip));

  if (peers.length === 0) {
    // Still clean up expired nodes even when no peers are found
    const expired = cleanupExpiredNodes(mechaDir, TTL_MS);
    if (expired.length > 0) {
      log.info("Cleaned up expired discovered nodes", { names: expired });
    }
    return;
  }

  // Build sets of already-known hosts (manual + discovered)
  const manualNodes = readNodes(mechaDir);
  const manualHosts = new Set(manualNodes.map((n) => n.host));

  const discoveredNodes = readDiscoveredNodes(mechaDir);
  const discoveredHosts = new Set(discoveredNodes.map((n) => n.host));

  const now = new Date().toISOString();

  // Track which discovered hosts are still visible for bulk lastSeen refresh
  const stillVisibleHosts = new Set<string>();

  for (const peer of peers) {
    // Skip if already in manual registry
    if (manualHosts.has(peer.ip)) continue;

    // If already discovered, mark as still visible
    if (discoveredHosts.has(peer.ip)) {
      stillVisibleHosts.add(peer.ip);
      continue;
    }

    // New peer — probe its agent healthz, then verify with an authenticated request
    try {
      const probePort = peer.port;
      const res = await fetch(`http://${peer.ip}:${probePort}/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;

      // Verify the peer shares the same mesh key by making an authenticated request.
      // Only register if the authenticated request also succeeds — this proves the
      // peer belongs to the same mesh (derives the same routing key from shared TOTP secret).
      const authRes = await fetch(`http://${peer.ip}:${probePort}/bots`, {
        headers: { Authorization: `Bearer ${meshApiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!authRes.ok) continue;

      // This peer has a running Mecha agent with matching mesh key — register it.
      const name = peer.hostname.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const entry: DiscoveredNode = {
        name,
        host: peer.ip,
        port: probePort,
        apiKey: meshApiKey,
        source: peer.source,
        lastSeen: now,
        addedAt: now,
      };
      writeDiscoveredNode(mechaDir, entry);
      log.info("Discovered new Mecha peer", { name, host: peer.ip, source: peer.source });
    /* v8 ignore start -- network probe failure */
    } catch {
      // Not running Mecha agent or unreachable — skip
    }
    /* v8 ignore stop */
  }

  // Bulk-refresh lastSeen for discovered nodes that are still online
  if (stillVisibleHosts.size > 0) {
    refreshDiscoveredNodes(mechaDir, stillVisibleHosts, now);
  }

  // Remove nodes not seen in 24 hours
  const expired = cleanupExpiredNodes(mechaDir, TTL_MS);
  if (expired.length > 0) {
    log.info("Cleaned up expired discovered nodes", { names: expired });
  }
}

/**
 * Start the periodic discovery timer.
 * Uses chained setTimeout (not setInterval) to prevent overlapping scans —
 * the next scan is scheduled only after the current one finishes.
 * Returns a cleanup function that stops the timer.
 */
export function startDiscoveryLoop(mechaDir: string, meshApiKey: string): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try { await runDiscoveryScan(mechaDir, meshApiKey); } catch { /* scan error */ }
      scheduleNext();
    }, SCAN_INTERVAL_MS);
  }

  // Initial scan (fire-and-forget), then start the chain
  runDiscoveryScan(mechaDir, meshApiKey).catch(() => {}).then(scheduleNext);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
