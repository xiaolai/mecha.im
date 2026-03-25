/**
 * Periodic Tailscale peer auto-discovery.
 *
 * Scans for online Tailscale peers, probes their Mecha agent healthz endpoint,
 * and writes newly found peers to the discovered-nodes registry.
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

const log = createLogger("mecha:discovery");

/** Default agent port to probe on discovered peers. */
const AGENT_PORT = 7660;

/** How long a discovered node may go unseen before being removed (24 hours). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Interval between discovery scans (60 seconds). */
export const SCAN_INTERVAL_MS = 60_000;

/**
 * Run a single discovery scan:
 * 1. Scan Tailscale for online peers
 * 2. Probe each unknown peer's healthz
 * 3. Register newly found Mecha agents in the discovered registry
 * 4. Refresh lastSeen for already-known peers that are still online
 * 5. Clean up nodes not seen for 24h
 */
export async function runDiscoveryScan(mechaDir: string, meshApiKey: string): Promise<void> {
  const peers = await scanTailscalePeers();
  if (peers.length === 0) return;

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

    // New peer — probe its agent healthz
    try {
      const res = await fetch(`http://${peer.ip}:${AGENT_PORT}/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;

      // This peer has a running Mecha agent — register it
      const name = peer.hostname.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const entry: DiscoveredNode = {
        name,
        host: peer.ip,
        port: AGENT_PORT,
        apiKey: meshApiKey,
        source: "tailscale",
        lastSeen: now,
        addedAt: now,
      };
      writeDiscoveredNode(mechaDir, entry);
      log.info("Discovered new Mecha peer", { name, host: peer.ip });
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
 * Returns a cleanup function that stops the timer.
 */
export function startDiscoveryLoop(mechaDir: string, meshApiKey: string): () => void {
  // Initial scan (fire-and-forget)
  runDiscoveryScan(mechaDir, meshApiKey).catch(() => {});

  // Periodic scan
  const timer = setInterval(() => {
    runDiscoveryScan(mechaDir, meshApiKey).catch(() => {});
  }, SCAN_INTERVAL_MS);

  return () => clearInterval(timer);
}
