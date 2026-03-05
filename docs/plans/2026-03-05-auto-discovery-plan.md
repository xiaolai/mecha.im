# Auto-Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Nodes automatically discover and register each other via Tailscale API + mDNS, authenticated by a shared cluster key.

**Architecture:** Discovery loop runs every 60s in the agent server process. Tailscale peers found via `tailscale status --json`, LAN peers via mDNS `_mecha._tcp`. Both paths converge at `POST /discover/handshake` to exchange cluster keys and node info. Discovered nodes stored in `nodes-discovered.json` (separate from manual `nodes.json`) with TTL-based expiry.

**Tech Stack:** Node.js, Fastify, Zod, `child_process` (Tailscale CLI), `@homebridge/ciao` or `multicast-dns` (mDNS), vitest.

**Design doc:** `docs/plans/2026-03-05-auto-discovery-design.md`

---

## Task 1: Discovered Node Registry (core)

**Files:**
- Create: `packages/core/src/discovered-registry.ts`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/__tests__/discovered-registry.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/core/__tests__/discovered-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readDiscoveredNodes,
  writeDiscoveredNode,
  removeDiscoveredNode,
  cleanupExpiredNodes,
  promoteDiscoveredNode,
  type DiscoveredNode,
} from "@mecha/core";

function makeNode(overrides: Partial<DiscoveredNode> = {}): DiscoveredNode {
  return {
    name: "test-node",
    host: "100.64.200.5",
    port: 7660,
    apiKey: "mesh-key-123",
    source: "tailscale",
    lastSeen: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("discovered-registry", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-disc-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("returns empty array when no file exists", () => {
    expect(readDiscoveredNodes(mechaDir)).toEqual([]);
  });

  it("writes and reads a discovered node", () => {
    const node = makeNode();
    writeDiscoveredNode(mechaDir, node);
    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("test-node");
  });

  it("updates lastSeen for existing node", () => {
    const node = makeNode({ lastSeen: "2020-01-01T00:00:00Z" });
    writeDiscoveredNode(mechaDir, node);
    const updated = makeNode({ lastSeen: "2026-03-05T12:00:00Z" });
    writeDiscoveredNode(mechaDir, updated);
    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.lastSeen).toBe("2026-03-05T12:00:00Z");
  });

  it("removes a discovered node", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "a" }));
    writeDiscoveredNode(mechaDir, makeNode({ name: "b" }));
    const removed = removeDiscoveredNode(mechaDir, "a");
    expect(removed).toBe(true);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);
  });

  it("returns false when removing non-existent node", () => {
    expect(removeDiscoveredNode(mechaDir, "ghost")).toBe(false);
  });

  it("cleans up nodes older than TTL", () => {
    const old = makeNode({
      name: "stale",
      lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const recent = makeNode({ name: "fresh" });
    writeDiscoveredNode(mechaDir, old);
    writeDiscoveredNode(mechaDir, recent);
    const removed = cleanupExpiredNodes(mechaDir, 60 * 60 * 1000); // 1 hour
    expect(removed).toEqual(["stale"]);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);
  });

  it("promotes a discovered node to manual registry", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "peer1", apiKey: "key1" }));
    const entry = promoteDiscoveredNode(mechaDir, "peer1");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("peer1");
    // Removed from discovered
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --project core discovered-registry`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/discovered-registry.ts
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";
import { addNode, readNodes, type NodeEntry } from "./node-registry.js";

const DISCOVERED_FILE = "nodes-discovered.json";

const DiscoveredNodeSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().nonnegative(),
  apiKey: z.string(),
  fingerprint: z.string().optional(),
  source: z.enum(["tailscale", "mdns"]),
  lastSeen: z.string(),
  addedAt: z.string(),
});

export type DiscoveredNode = z.infer<typeof DiscoveredNodeSchema>;

const DiscoveredArraySchema = z.array(DiscoveredNodeSchema);

function discoveredPath(mechaDir: string): string {
  return join(mechaDir, DISCOVERED_FILE);
}

export function readDiscoveredNodes(mechaDir: string): DiscoveredNode[] {
  const result = safeReadJson(discoveredPath(mechaDir), "discovered nodes", DiscoveredArraySchema);
  if (!result.ok) return [];
  return result.data;
}

function writeDiscoveredNodes(mechaDir: string, nodes: DiscoveredNode[]): void {
  const path = discoveredPath(mechaDir);
  const tmp = path + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(nodes, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Write or update a discovered node entry. Updates lastSeen if already exists. */
export function writeDiscoveredNode(mechaDir: string, node: DiscoveredNode): void {
  DiscoveredNodeSchema.parse(node);
  const nodes = readDiscoveredNodes(mechaDir);
  const idx = nodes.findIndex((n) => n.name === node.name);
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx]!, ...node };
  } else {
    nodes.push(node);
  }
  writeDiscoveredNodes(mechaDir, nodes);
}

/** Remove a discovered node. Returns false if not found. */
export function removeDiscoveredNode(mechaDir: string, name: string): boolean {
  const nodes = readDiscoveredNodes(mechaDir);
  const filtered = nodes.filter((n) => n.name !== name);
  if (filtered.length === nodes.length) return false;
  writeDiscoveredNodes(mechaDir, filtered);
  return true;
}

/** Remove nodes not seen within ttlMs. Returns names of removed nodes. */
export function cleanupExpiredNodes(mechaDir: string, ttlMs: number): string[] {
  const nodes = readDiscoveredNodes(mechaDir);
  const now = Date.now();
  const removed: string[] = [];
  const kept = nodes.filter((n) => {
    const age = now - new Date(n.lastSeen).getTime();
    if (age > ttlMs) {
      removed.push(n.name);
      return false;
    }
    return true;
  });
  if (removed.length > 0) writeDiscoveredNodes(mechaDir, kept);
  return removed;
}

/** Promote a discovered node to manual nodes.json. Returns the NodeEntry or undefined. */
export function promoteDiscoveredNode(mechaDir: string, name: string): NodeEntry | undefined {
  const nodes = readDiscoveredNodes(mechaDir);
  const discovered = nodes.find((n) => n.name === name);
  if (!discovered) return undefined;

  const entry: NodeEntry = {
    name: discovered.name,
    host: discovered.host,
    port: discovered.port,
    apiKey: discovered.apiKey,
    addedAt: new Date().toISOString(),
  };

  // Check if already in manual registry (skip addNode if so)
  const manual = readNodes(mechaDir);
  if (!manual.some((n) => n.name === name)) {
    addNode(mechaDir, entry);
  }

  removeDiscoveredNode(mechaDir, name);
  return entry;
}
```

**Step 4: Add exports to core index**

Add to `packages/core/src/index.ts`:
```typescript
export {
  readDiscoveredNodes,
  writeDiscoveredNode,
  removeDiscoveredNode,
  cleanupExpiredNodes,
  promoteDiscoveredNode,
  type DiscoveredNode,
} from "./discovered-registry.js";
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run --project core discovered-registry`
Expected: all 7 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/discovered-registry.ts packages/core/src/index.ts packages/core/__tests__/discovered-registry.test.ts
git commit -m "feat(core): add discovered node registry with TTL cleanup and promote"
```

---

## Task 2: Tailscale Scanner (core)

**Files:**
- Create: `packages/core/src/tailscale-scanner.ts`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/__tests__/tailscale-scanner.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/core/__tests__/tailscale-scanner.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseTailscaleStatus, type TailscalePeer } from "@mecha/core";

describe("parseTailscaleStatus", () => {
  it("extracts online peers with IPs", () => {
    const json = {
      Self: { TailscaleIPs: ["100.64.200.1"], HostName: "macbook" },
      Peer: {
        "nodekey:abc": {
          TailscaleIPs: ["100.64.200.5"],
          HostName: "overlay-node-4",
          Online: true,
          OS: "linux",
        },
        "nodekey:def": {
          TailscaleIPs: ["100.64.200.7"],
          HostName: "mac-mini",
          Online: false,
          OS: "macOS",
        },
      },
    };
    const peers = parseTailscaleStatus(json);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ ip: "100.64.200.5", hostname: "overlay-node-4" });
  });

  it("returns empty array when no peers", () => {
    const json = { Self: { TailscaleIPs: ["100.64.200.1"] }, Peer: {} };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });

  it("skips peers without IPs", () => {
    const json = {
      Self: { TailscaleIPs: ["100.64.200.1"] },
      Peer: {
        "nodekey:abc": { TailscaleIPs: [], HostName: "ghost", Online: true },
      },
    };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });

  it("excludes self IP", () => {
    const json = {
      Self: { TailscaleIPs: ["100.64.200.1"] },
      Peer: {
        "nodekey:abc": { TailscaleIPs: ["100.64.200.1"], HostName: "self", Online: true },
      },
    };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --project core tailscale-scanner`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/tailscale-scanner.ts
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
  } catch (err) {
    log.warn("Tailscale scan failed", { detail: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
```

**Step 4: Add exports to core index**

Add to `packages/core/src/index.ts`:
```typescript
export { parseTailscaleStatus, scanTailscalePeers, type TailscalePeer } from "./tailscale-scanner.js";
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run --project core tailscale-scanner`
Expected: all 4 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/tailscale-scanner.ts packages/core/src/index.ts packages/core/__tests__/tailscale-scanner.test.ts
git commit -m "feat(core): add Tailscale status parser and scanner"
```

---

## Task 3: Handshake Route (agent)

**Files:**
- Create: `packages/agent/src/routes/discover-handshake.ts`
- Modify: `packages/agent/src/server.ts` (register route)
- Modify: `packages/agent/src/auth.ts` (add public path)
- Test: `packages/agent/__tests__/routes/discover-handshake.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/agent/__tests__/routes/discover-handshake.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerHandshakeRoute } from "../../src/routes/discover-handshake.js";
import { readDiscoveredNodes } from "@mecha/core";

const CLUSTER_KEY = "test-cluster-key-123";

describe("POST /discover/handshake", () => {
  let app: FastifyInstance;
  let mechaDir: string;

  beforeEach(async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-hs-"));
    app = Fastify();
    registerHandshakeRoute(app, {
      clusterKey: CLUSTER_KEY,
      nodeName: "alice",
      port: 7660,
      mechaDir,
      meshApiKey: "alice-mesh-key",
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("accepts valid handshake and registers peer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/discover/handshake",
      payload: {
        clusterKey: CLUSTER_KEY,
        nodeName: "bob",
        port: 7660,
        tailscaleIp: "100.64.200.9",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.nodeName).toBe("alice");
    expect(body.meshApiKey).toBe("alice-mesh-key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("bob");
  });

  it("rejects wrong cluster key with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/discover/handshake",
      payload: {
        clusterKey: "wrong-key",
        nodeName: "eve",
        port: 7660,
        tailscaleIp: "100.64.200.99",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("rejects handshake from self", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/discover/handshake",
      payload: {
        clusterKey: CLUSTER_KEY,
        nodeName: "alice",
        port: 7660,
        tailscaleIp: "100.64.200.1",
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid body with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/discover/handshake",
      payload: { clusterKey: CLUSTER_KEY },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --project agent discover-handshake`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/agent/src/routes/discover-handshake.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { writeDiscoveredNode, type DiscoveredNode } from "@mecha/core";
import { timingSafeEqual } from "node:crypto";

export interface HandshakeRouteOpts {
  clusterKey: string;
  nodeName: string;
  port: number;
  mechaDir: string;
  meshApiKey?: string;
  fingerprint?: string;
}

interface HandshakeBody {
  clusterKey: string;
  nodeName: string;
  port: number;
  tailscaleIp?: string;
  lanIp?: string;
  fingerprint?: string;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerHandshakeRoute(app: FastifyInstance, opts: HandshakeRouteOpts): void {
  app.post(
    "/discover/handshake",
    async (request: FastifyRequest<{ Body: HandshakeBody }>, reply) => {
      const body = request.body;
      if (!body || !body.clusterKey || !body.nodeName || !body.port) {
        return reply.code(400).send({ error: "Missing required fields" });
      }

      // Timing-safe cluster key comparison
      if (!safeEqual(body.clusterKey, opts.clusterKey)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      // Self-discovery guard
      if (body.nodeName === opts.nodeName) {
        return reply.code(409).send({ error: "Self-discovery" });
      }

      // Determine best host IP
      const host = body.tailscaleIp ?? body.lanIp ?? request.ip;

      // Register the peer
      const discovered: DiscoveredNode = {
        name: body.nodeName,
        host,
        port: body.port,
        apiKey: "", // Will be set from their handshake response to us
        fingerprint: body.fingerprint,
        source: body.tailscaleIp ? "tailscale" : "mdns",
        lastSeen: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      };
      writeDiscoveredNode(opts.mechaDir, discovered);

      return {
        accepted: true,
        nodeName: opts.nodeName,
        fingerprint: opts.fingerprint,
        port: opts.port,
        meshApiKey: opts.meshApiKey,
      };
    },
  );
}
```

**Step 4: Register route in server.ts**

Add import at top of `packages/agent/src/server.ts`:
```typescript
import { registerHandshakeRoute } from "./routes/discover-handshake.js";
```

Add after `registerMeterRoutes(...)` call (around line 197):
```typescript
  // Auto-discovery handshake (only active when cluster key is set)
  const clusterKey = process.env.MECHA_CLUSTER_KEY;
  if (clusterKey) {
    registerHandshakeRoute(app, {
      clusterKey,
      nodeName: opts.nodeName,
      port: opts.port,
      mechaDir: opts.mechaDir,
      meshApiKey: opts.auth.apiKey,
    });
  }
```

**Step 5: Add `/discover/handshake` to public paths in auth.ts**

In `packages/agent/src/auth.ts`, add `"/discover/handshake"` to the `PUBLIC_PATHS` array.

**Step 6: Run tests to verify they pass**

Run: `npx vitest run --project agent discover-handshake`
Expected: all 4 tests PASS

**Step 7: Commit**

```bash
git add packages/agent/src/routes/discover-handshake.ts packages/agent/src/server.ts packages/agent/src/auth.ts packages/agent/__tests__/routes/discover-handshake.test.ts
git commit -m "feat(agent): add discovery handshake endpoint with cluster key auth"
```

---

## Task 4: Discovery Loop (agent)

**Files:**
- Create: `packages/agent/src/discovery-loop.ts`
- Modify: `packages/agent/src/server.ts` (start loop)
- Test: `packages/agent/__tests__/discovery-loop.test.ts`

**Step 1: Write the failing tests**

Test the loop's `probeCandidates` and `runDiscoveryCycle` logic with mocked fetch/scanner.

```typescript
// packages/agent/__tests__/discovery-loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDiscoveredNodes } from "@mecha/core";
import { probeCandidates } from "../../src/discovery-loop.js";

describe("probeCandidates", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-dl-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("registers a peer that responds to handshake", async () => {
    const fetchMock = vi.fn()
      // First call: healthz probe
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", node: "bob" })))
      // Second call: handshake
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accepted: true,
        nodeName: "bob",
        port: 7660,
        meshApiKey: "bob-key",
      })));

    await probeCandidates({
      candidates: [{ ip: "100.64.200.9", port: 7660, source: "tailscale" as const }],
      clusterKey: "test-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("bob");
    expect(nodes[0]!.apiKey).toBe("bob-key");
  });

  it("skips candidates that fail healthz", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));

    await probeCandidates({
      candidates: [{ ip: "100.64.200.99", port: 7660, source: "tailscale" as const }],
      clusterKey: "test-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("skips candidates where handshake returns 403", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", node: "eve" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));

    await probeCandidates({
      candidates: [{ ip: "100.64.200.50", port: 7660, source: "tailscale" as const }],
      clusterKey: "wrong-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --project agent discovery-loop`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/agent/src/discovery-loop.ts
import {
  scanTailscalePeers,
  readDiscoveredNodes,
  writeDiscoveredNode,
  cleanupExpiredNodes,
  readNodes,
  createLogger,
  DEFAULTS,
  type DiscoveredNode,
  type TailscalePeer,
} from "@mecha/core";

const log = createLogger("discovery-loop");

const SCAN_INTERVAL_MS = 60_000;
const OFFLINE_TTL_MS = 5 * 60_000;     // 5 min → offline
const EXPIRY_TTL_MS = 60 * 60_000;     // 1 hour → removed
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
      // Cleanup expired nodes
      const removed = cleanupExpiredNodes(opts.mechaDir, EXPIRY_TTL_MS);
      if (removed.length > 0) {
        log.info(`Removed expired nodes: ${removed.join(", ")}`);
      }

      // Collect known node names (manual + discovered) to skip
      const manual = readNodes(opts.mechaDir);
      const discovered = readDiscoveredNodes(opts.mechaDir);
      const knownHosts = new Set([
        ...manual.map((n) => n.host),
        ...discovered.map((n) => n.host),
      ]);

      // Scan Tailscale
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

      // TODO: mDNS scanning (Task 5)

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

  // Run immediately, then on interval
  cycle();
  timer = setInterval(cycle, SCAN_INTERVAL_MS);

  return () => {
    if (timer) clearInterval(timer);
  };
}
```

**Step 4: Integrate into server.ts**

Add import:
```typescript
import { startDiscoveryLoop } from "./discovery-loop.js";
```

After the cluster key handshake registration (from Task 3), add:
```typescript
  if (clusterKey) {
    // ... existing handshake registration ...
    const stopDiscovery = startDiscoveryLoop({
      clusterKey,
      nodeName: opts.nodeName,
      port: opts.port,
      mechaDir: opts.mechaDir,
    });
    app.addHook("onClose", stopDiscovery);
  }
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run --project agent discovery-loop`
Expected: all 3 tests PASS

**Step 6: Commit**

```bash
git add packages/agent/src/discovery-loop.ts packages/agent/src/server.ts packages/agent/__tests__/discovery-loop.test.ts
git commit -m "feat(agent): add periodic discovery loop with Tailscale scanning"
```

---

## Task 5: Mesh Routes Union (agent)

**Files:**
- Modify: `packages/agent/src/routes/mesh.ts` (union discovered nodes)
- Test: Verify existing tests still pass, add new test

**Step 1: Modify `registerMeshRoutes` in mesh.ts**

In the `GET /mesh/nodes` handler, after reading `entries` from `readNodes()`, also read discovered nodes and merge:

```typescript
import { readDiscoveredNodes, type DiscoveredNode } from "@mecha/core";

// Inside the handler, after: entries = readNodes(opts.mechaDir);
// Add:
let discoveredEntries: DiscoveredNode[] = [];
try {
  discoveredEntries = readDiscoveredNodes(opts.mechaDir);
} catch {
  log.warn("Failed to read discovered nodes");
}

// Filter out discovered nodes that conflict with manual entries
const manualNames = new Set(entries.map((e) => e.name));
const uniqueDiscovered = discoveredEntries
  .filter((d) => !manualNames.has(d.name))
  .map((d): NodeEntry => ({
    name: d.name,
    host: d.host,
    port: d.port,
    apiKey: d.apiKey,
    addedAt: d.addedAt,
  }));

// Check both manual + discovered
const allRemoteEntries = [...entries, ...uniqueDiscovered];
const remoteNodes = await checkNodesWithConcurrencyLimit(allRemoteEntries);
```

**Step 2: Run existing mesh tests**

Run: `npx vitest run --project agent mesh`
Expected: PASS (no regression)

**Step 3: Commit**

```bash
git add packages/agent/src/routes/mesh.ts
git commit -m "feat(agent): union discovered nodes into mesh health view"
```

---

## Task 6: CLI — node promote command

**Files:**
- Create: `packages/cli/src/commands/node-promote.ts`
- Modify: `packages/cli/src/commands/node.ts` (register command)
- Test: `packages/cli/__tests__/commands/node-promote.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/__tests__/commands/node-promote.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeDiscoveredNode, readDiscoveredNodes, readNodes } from "@mecha/core";
import { makeDeps, createProgram } from "../helpers.js";

describe("node promote", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-promote-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("promotes a discovered node to manual registry", async () => {
    writeDiscoveredNode(mechaDir, {
      name: "bob",
      host: "100.64.200.9",
      port: 7660,
      apiKey: "bob-key",
      source: "tailscale",
      lastSeen: new Date().toISOString(),
      addedAt: new Date().toISOString(),
    });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();
    await program.parseAsync(["node", "mecha", "node", "promote", "bob"]);

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
    const manual = readNodes(mechaDir);
    expect(manual).toHaveLength(1);
    expect(manual[0]!.name).toBe("bob");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("bob"));
  });

  it("errors when node not found", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();
    await program.parseAsync(["node", "mecha", "node", "promote", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --project cli node-promote`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/cli/src/commands/node-promote.ts
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { promoteDiscoveredNode } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerNodePromoteCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("promote")
    .description("Promote a discovered node to manual registry")
    .argument("<name>", "Discovered node name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const entry = promoteDiscoveredNode(deps.mechaDir, name);
      if (!entry) {
        deps.formatter.error(`Discovered node not found: ${name}`);
        process.exitCode = 1;
        return;
      }
      deps.formatter.success(`Promoted ${name} (${entry.host}:${entry.port}) to manual registry`);
    }));
}
```

**Step 4: Register in node.ts**

Add to `packages/cli/src/commands/node.ts`:
```typescript
import { registerNodePromoteCommand } from "./node-promote.js";
// ... in registerNodeCommand():
registerNodePromoteCommand(node, deps);
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run --project cli node-promote`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/cli/src/commands/node-promote.ts packages/cli/src/commands/node.ts packages/cli/__tests__/commands/node-promote.test.ts
git commit -m "feat(cli): add node promote command for discovered nodes"
```

---

## Task 7: CLI — node ls shows discovered nodes

**Files:**
- Modify: `packages/cli/src/commands/node-ls.ts`
- Modify existing test if needed

**Step 1: Update node-ls to show source label**

Read `readDiscoveredNodes()` in addition to `readNodes()`, add a "Source" column to the table showing "manual" or "discovered", and for discovered nodes also show whether they're within the offline TTL.

**Step 2: Run existing tests**

Run: `npx vitest run --project cli node`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/cli/src/commands/node-ls.ts
git commit -m "feat(cli): show discovered nodes with source label in node ls"
```

---

## Task 8: SPA — Nodes page shows source badge

**Files:**
- Modify: `packages/spa/src/components/nodes-view.tsx`

**Step 1: Update NodeHealth interface**

Add `source?: "manual" | "discovered"` field to `NodeHealth` interface.

**Step 2: Show source badge on NodeCard**

Add a small badge next to the node name showing "discovered" (muted) or nothing for manual nodes. Discovered nodes can also show the discovery source (tailscale/mdns).

**Step 3: Build and verify**

Run: `pnpm --filter @mecha/spa build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add packages/spa/src/components/nodes-view.tsx
git commit -m "feat(spa): show discovered/manual source badge on node cards"
```

---

## Task 9: Documentation

**Files:**
- Modify: `website/docs/features/mesh-networking.md` (add auto-discovery section)
- Modify: `website/docs/reference/environment.md` (add MECHA_CLUSTER_KEY)
- Modify: `website/docs/reference/cli.md` (add node promote command)

**Step 1: Update docs**

Document MECHA_CLUSTER_KEY, the auto-discovery behavior, `node promote`, and the handshake protocol.

**Step 2: Commit**

```bash
git add website/docs/
git commit -m "docs: add auto-discovery protocol documentation"
```

---

## Task 10: mDNS Scanner (core) — Phase 2

> **Note:** This task can be deferred. Tailscale discovery (Tasks 1-9) is fully functional without mDNS. Add mDNS when LAN-only machines need discovery.

**Files:**
- Create: `packages/core/src/mdns-scanner.ts`
- Modify: `packages/agent/src/discovery-loop.ts` (add mDNS candidates)
- Add `multicast-dns` or `@homebridge/ciao` dependency

This task adds mDNS service advertisement (`_mecha._tcp`) and browsing. The discovery loop merges mDNS candidates with Tailscale candidates before probing.

---

## Execution Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | core | Discovered node registry (CRUD + TTL + promote) |
| 2 | core | Tailscale status parser and scanner |
| 3 | agent | Handshake route (`POST /discover/handshake`) |
| 4 | agent | Discovery loop (periodic scan + probe) |
| 5 | agent | Mesh routes union (manual + discovered) |
| 6 | cli | `node promote` command |
| 7 | cli | `node ls` shows source label |
| 8 | spa | Source badge on node cards |
| 9 | docs | Documentation updates |
| 10 | core | mDNS scanner (deferred) |

**CLI-first order:** Tasks 1-2 (core) → 6-7 (cli) → 3-5 (agent) → 8 (spa) → 9 (docs)
