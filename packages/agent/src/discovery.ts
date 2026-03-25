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
      const res = await fetch(`http://${peer.ip}:${AGENT_PORT}/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;

      // Verify the peer shares the same mesh key by making an authenticated request.
      // Only register if the authenticated request also succeeds — this proves the
      // peer belongs to the same mesh (derives the same routing key from shared TOTP secret).
      const authRes = await fetch(`http://${peer.ip}:${AGENT_PORT}/bots`, {
        headers: { Authorization: `Bearer ${meshApiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!authRes.ok) continue;

      // This peer has a running Mecha agent with matching mesh key — register it.
      const name = peer.hostname.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      // All nodes in the mesh derive the same routing key from the shared TOTP
      // secret, so the local meshApiKey is valid for querying peers.
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
