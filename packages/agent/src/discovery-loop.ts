import {
  scanTailscalePeers,
  readDiscoveredNodes,
  writeDiscoveredNode,
  cleanupExpiredNodes,
  readNodes,
  createLogger,
  DEFAULTS,
  type DiscoveredNode,
} from "@mecha/core";

const log = createLogger("discovery-loop");

const SCAN_INTERVAL_MS = 60_000;
const EXPIRY_TTL_MS = 60 * 60_000; // 1 hour → removed
const PROBE_TIMEOUT_MS = 5_000;

export interface DiscoveryCandidate {
  ip: string;
  port: number;
  source: "tailscale" | "mdns";
}

export interface ProbeOpts {
  candidates: DiscoveryCandidate[];
  clusterKey: string;
  nodeName: string;
  port: number;
  mechaDir: string;
  tailscaleIp?: string;
  lanIp?: string;
  fetchFn?: typeof fetch;
}

/** Probe candidates and register responding peers. Exported for testing. */
export async function probeCandidates(opts: ProbeOpts): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;

  for (const candidate of opts.candidates) {
    try {
      // Step 1: Check if it's a mecha node
      const healthRes = await fetchFn(`http://${candidate.ip}:${candidate.port}/healthz`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!healthRes.ok) continue;

      const health = await healthRes.json() as { status?: string; node?: string };
      if (health.status !== "ok" || !health.node) continue;

      // Skip self
      if (health.node === opts.nodeName) continue;

      // Step 2: Handshake
      const hsRes = await fetchFn(`http://${candidate.ip}:${candidate.port}/discover/handshake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clusterKey: opts.clusterKey,
          nodeName: opts.nodeName,
          port: opts.port,
          tailscaleIp: opts.tailscaleIp,
          lanIp: opts.lanIp,
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (!hsRes.ok) {
        log.warn(`Handshake rejected by ${candidate.ip}`, { status: hsRes.status });
        continue;
      }

      const hsBody = await hsRes.json() as {
        accepted?: boolean;
        nodeName?: string;
        meshApiKey?: string;
        port?: number;
        fingerprint?: string;
      };

      if (!hsBody.accepted || !hsBody.nodeName) continue;

      const discovered: DiscoveredNode = {
        name: hsBody.nodeName,
        host: candidate.ip,
        port: hsBody.port ?? candidate.port,
        apiKey: hsBody.meshApiKey ?? "",
        fingerprint: hsBody.fingerprint,
        source: candidate.source,
        lastSeen: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      };

      writeDiscoveredNode(opts.mechaDir, discovered);
      log.info(`Discovered node: ${discovered.name} (${candidate.ip}:${discovered.port})`);
    } catch {
      // Probe failed — skip silently
    }
  }
}

export interface DiscoveryLoopOpts {
  clusterKey: string;
  nodeName: string;
  port: number;
  mechaDir: string;
}

/** Start the discovery loop. Returns a cleanup function to stop it. */
export function startDiscoveryLoop(opts: DiscoveryLoopOpts): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  async function cycle(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const removed = cleanupExpiredNodes(opts.mechaDir, EXPIRY_TTL_MS);
      if (removed.length > 0) {
        log.info(`Removed expired nodes: ${removed.join(", ")}`);
      }

      const manual = readNodes(opts.mechaDir);
      const discovered = readDiscoveredNodes(opts.mechaDir);
      const knownHosts = new Set([
        ...manual.map((n) => n.host),
        ...discovered.map((n) => n.host),
      ]);

      const tsPeers = await scanTailscalePeers();
      const candidates: DiscoveryCandidate[] = tsPeers
        .filter((p) => !knownHosts.has(p.ip))
        .map((p) => ({ ip: p.ip, port: DEFAULTS.AGENT_PORT, source: "tailscale" as const }));

      // Update lastSeen for already-known discovered nodes that are still visible
      const tsIps = new Set(tsPeers.map((p) => p.ip));
      for (const node of discovered) {
        if (tsIps.has(node.host)) {
          writeDiscoveredNode(opts.mechaDir, { ...node, lastSeen: new Date().toISOString() });
        }
      }

      if (candidates.length > 0) {
        await probeCandidates({
          candidates,
          clusterKey: opts.clusterKey,
          nodeName: opts.nodeName,
          port: opts.port,
          mechaDir: opts.mechaDir,
        });
      }
    } catch (err) {
      log.warn("Discovery cycle failed", { detail: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  }

  cycle();
  timer = setInterval(cycle, SCAN_INTERVAL_MS);

  return () => {
    if (timer) clearInterval(timer);
  };
}
