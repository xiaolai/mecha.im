/**
 * Shared test infrastructure for multi-node integration tests.
 *
 * Creates a "test mesh" on loopback: one rendezvous/relay server + N agent nodes.
 * All ports are 0 (random), all crypto is real Ed25519/X25519.
 */

import { vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, generateKeyPairSync, sign } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createServer,
  nodes,
  invites,
  relayPairs,
  createRelayToken,
} from "@mecha/server";
import { createAgentServer } from "@mecha/agent";
import {
  type AclEngine,
  type Capability,
  type NodeEntry,
  createAclEngine,
  generateNoiseKeyPair,
  readNodes,
  writeNodes,
} from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import { createCasaRouter, createLocator, agentFetch } from "@mecha/service";
import type { CasaRouter, MechaLocator } from "@mecha/service";

// ─── Types ───────────────────────────────────────────────────────────────

export interface TestMesh {
  /** The rendezvous/relay server */
  server: FastifyInstance;
  serverPort: number;
  serverBaseUrl: string;
  serverWsUrl: string;
  /** HMAC secret for relay tokens */
  secret: Buffer;
  /** Add a test node to the mesh */
  addNode(name: string, opts?: AddNodeOpts): Promise<TestNode>;
  /** All created nodes */
  nodes: TestNode[];
  /** Clean up everything */
  cleanup(): Promise<void>;
}

export interface AddNodeOpts {
  /** ACL engine override. Defaults to makeOpenAcl() */
  acl?: AclEngine;
  /** CASA configs to write (name → { port, token, workspace }) */
  casas?: Record<string, { port: number; token: string; workspace: string }>;
  /** Process manager override */
  pm?: ProcessManager;
  /** Expose override for ACL engine */
  getExpose?: (name: string) => Capability[];
  /** Write nodes.json with these entries */
  nodeEntries?: NodeEntry[];
}

export interface TestNode {
  name: string;
  mechaDir: string;
  agentServer: FastifyInstance;
  agentPort: number;
  apiKey: string;
  acl: AclEngine;
  pm: ProcessManager;
  locator: MechaLocator;
  router: CasaRouter;
  /** Public key (base64 DER) */
  publicKey: string;
  /** Private key (crypto KeyObject) */
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  /** Ed25519 fingerprint */
  fingerprint: string;
  /** Noise X25519 key pair */
  noiseKeyPair: { publicKey: string; privateKey: string };
  /** Register this node as a peer on another node */
  registerPeer(target: TestNode): void;
  /** Create a signFn for agent-fetch signed requests */
  signFn: (data: Uint8Array) => Uint8Array;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a ProcessManager fake that returns the given list.
 * No real child processes are spawned.
 */
export function makePm(list: ProcessInfo[] = []): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockImplementation((name: string) => list.find((p) => p.name === name)),
    list: vi.fn().mockReturnValue(list),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

/**
 * Create an open ACL engine that allows everything.
 * Uses a real engine with getExpose returning all capabilities.
 */
export function makeOpenAcl(mechaDir: string): AclEngine {
  return createAclEngine({
    mechaDir,
    getExpose: () => ["query", "read_sessions", "read_workspace", "write_workspace", "execute", "lifecycle"] as Capability[],
  });
}

/**
 * Create a mock AclEngine with check always returning the given result.
 */
export function makeMockAcl(overrides: Partial<AclEngine> = {}): AclEngine {
  return {
    grant: vi.fn(),
    revoke: vi.fn(),
    check: vi.fn().mockReturnValue({ allowed: true }),
    listRules: vi.fn().mockReturnValue([]),
    listConnections: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    ...overrides,
  } as unknown as AclEngine;
}

// ─── Mesh Factory ────────────────────────────────────────────────────────

/**
 * Create a test mesh with a real rendezvous/relay server on loopback.
 */
export async function createTestMesh(): Promise<TestMesh> {
  const secret = randomBytes(32);
  const testNodes: TestNode[] = [];

  // Clear global server state
  nodes.clear();
  invites.clear();
  relayPairs.clear();

  // Start rendezvous/relay server on random port
  const server = await createServer({
    port: 0,
    host: "127.0.0.1",
    relayUrl: "ws://127.0.0.1:0", // placeholder, overridden per-test
    secret,
  });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const addr = server.server.address();
  const serverPort = typeof addr === "object" && addr ? addr.port : 0;
  const serverBaseUrl = `http://127.0.0.1:${serverPort}`;
  const serverWsUrl = `ws://127.0.0.1:${serverPort}`;

  async function addNode(name: string, opts: AddNodeOpts = {}): Promise<TestNode> {
    // Create temp directory for this node
    const mechaDir = mkdtempSync(join(tmpdir(), `mesh-${name}-`));

    // Generate real Ed25519 identity
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubDer = publicKey.export({ type: "spki", format: "der" });
    const pubB64 = pubDer.toString("base64");
    const fp = `fp-${name}-${randomBytes(4).toString("hex")}`;

    // Generate real X25519 noise key pair
    const noiseKeyPair = generateNoiseKeyPair();

    // Write CASA configs if provided
    if (opts.casas) {
      for (const [casaName, cfg] of Object.entries(opts.casas)) {
        const casaDir = join(mechaDir, casaName);
        mkdirSync(casaDir, { recursive: true });
        writeFileSync(join(casaDir, "config.json"), JSON.stringify(cfg));
      }
    }

    // Write nodes.json if entries provided
    if (opts.nodeEntries) {
      writeNodes(mechaDir, opts.nodeEntries);
    }

    const apiKey = `${name}-api-key-${randomBytes(8).toString("hex")}`;
    const pm = opts.pm ?? makePm();
    const acl = opts.acl ?? makeOpenAcl(mechaDir);

    // Start agent server on random port
    const agentServer = createAgentServer({
      port: 0,
      auth: { apiKey },
      processManager: pm,
      acl,
      mechaDir,
      nodeName: name,
      startedAt: new Date().toISOString(),
    });
    const agentAddr = await agentServer.listen({ port: 0, host: "127.0.0.1" });
    const agentPort = parseInt(new URL(agentAddr).port, 10);

    // Create locator + router
    const locator = createLocator({
      mechaDir,
      pm,
      getNodes: () => {
        // Read nodes from other TestNodes
        const entries: NodeEntry[] = [];
        for (const other of testNodes) {
          if (other.name !== name) {
            entries.push({
              name: other.name as NodeEntry["name"],
              host: "127.0.0.1",
              port: other.agentPort,
              apiKey: other.apiKey,
              publicKey: other.publicKey,
              fingerprint: other.fingerprint,
              addedAt: new Date().toISOString(),
            });
          }
        }
        return entries;
      },
    });

    const router = createCasaRouter({
      mechaDir,
      acl,
      pm,
      locator,
      agentFetch,
      sourceName: name,
      allowPrivateHosts: true,
    });

    const signFn = (data: Uint8Array): Uint8Array => {
      return new Uint8Array(sign(null, Buffer.from(data), privateKey));
    };

    const node: TestNode = {
      name,
      mechaDir,
      agentServer,
      agentPort,
      apiKey,
      acl,
      pm,
      locator,
      router,
      publicKey: pubB64,
      privateKey,
      fingerprint: fp,
      noiseKeyPair,
      signFn,
      registerPeer(target: TestNode) {
        let entries: NodeEntry[] = [];
        try {
          entries = readNodes(mechaDir);
        } catch {
          // No existing nodes
        }
        entries.push({
          name: target.name as NodeEntry["name"],
          host: "127.0.0.1",
          port: target.agentPort,
          apiKey: target.apiKey,
          publicKey: target.publicKey,
          fingerprint: target.fingerprint,
          addedAt: new Date().toISOString(),
        });
        writeNodes(mechaDir, entries);
      },
    };

    testNodes.push(node);
    return node;
  }

  async function cleanup(): Promise<void> {
    for (const node of testNodes) {
      try { await node.agentServer.close(); } catch { /* ignore */ }
      try { rmSync(node.mechaDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    testNodes.length = 0;
    try { await server.close(); } catch { /* ignore */ }
    nodes.clear();
    invites.clear();
    relayPairs.clear();
  }

  return {
    server,
    serverPort,
    serverBaseUrl,
    serverWsUrl,
    secret,
    addNode,
    nodes: testNodes,
    cleanup,
  };
}

/**
 * Create a valid HMAC relay token for the given secret.
 */
export function makeRelayToken(secret: Buffer, peer = "test"): string {
  return createRelayToken(secret, { peer, srv: "127.0.0.1" });
}

/**
 * Write a CASA config.json to the given mechaDir.
 */
export function writeCasaConfig(
  mechaDir: string,
  name: string,
  cfg: { port: number; token: string; workspace: string; expose?: string[] },
): void {
  const dir = join(mechaDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}
