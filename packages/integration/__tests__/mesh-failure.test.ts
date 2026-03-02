/**
 * Integration tests for error paths and resilience.
 *
 * Tests failure modes in multi-node mesh:
 * - Offline nodes (connection refused)
 * - SSRF protection
 * - Invalid CASA names
 * - Missing fields in query body
 * - REST lookup for unknown peers
 */

import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Capability, NodeEntry } from "@mecha/core";
import { createAclEngine } from "@mecha/core";
import { createAgentServer } from "@mecha/agent";
import {
  createServer,
  nodes,
  invites,
  relayPairs,
} from "@mecha/server";
import { createCasaRouter, createLocator, agentFetch } from "@mecha/service";
import { makePm, writeCasaConfig } from "./helpers/mesh-harness.js";
import type { FastifyInstance } from "fastify";

// Mock forwardQueryToCasa
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    forwardQueryToCasa: vi.fn().mockResolvedValue({
      text: "response",
      sessionId: "sess",
    }),
  };
});

describe("mesh failure: offline nodes", () => {
  let aliceDir: string;

  beforeAll(() => {
    aliceDir = mkdtempSync(join(tmpdir(), "fail-alice-"));
  });

  afterAll(() => {
    rmSync(aliceDir, { recursive: true, force: true });
  });

  it("query to offline node (nothing listening) throws connection error", async () => {
    // Port 1 is almost certainly not listening
    const offlineNode: NodeEntry = {
      name: "offline" as NodeEntry["name"],
      host: "127.0.0.1",
      port: 1, // nothing listening here
      apiKey: "fake-key",
      addedAt: new Date().toISOString(),
    };

    const acl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder", "analyst@offline", ["query"] as Capability[]);

    const locator = createLocator({
      mechaDir: aliceDir,
      pm: makePm(),
      getNodes: () => [offlineNode],
    });
    const router = createCasaRouter({
      mechaDir: aliceDir, acl, pm: makePm(), locator,
      agentFetch, sourceName: "alice", allowPrivateHosts: true,
    });

    await expect(
      router.routeQuery("coder", "analyst@offline", "hello"),
    ).rejects.toThrow();
  });

  it("agentFetch for managed node without channel throws ConnectError", async () => {
    const managedNode: NodeEntry = {
      name: "managed" as NodeEntry["name"],
      host: "127.0.0.1",
      port: 7700,
      apiKey: "key",
      managed: true,
      publicKey: "pk",
      fingerprint: "fp",
      addedAt: new Date().toISOString(),
    };

    await expect(
      agentFetch({
        node: managedNode,
        path: "/casas/test/query",
        method: "POST",
        body: { message: "hello" },
        allowPrivateHosts: true,
      }),
    ).rejects.toThrow("SecureChannel");
  });
});

describe("mesh failure: SSRF protection", () => {
  it("agentFetch to private IP without allowPrivateHosts is rejected", async () => {
    const privateNode: NodeEntry = {
      name: "private" as NodeEntry["name"],
      host: "192.168.1.100",
      port: 7700,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    };

    await expect(
      agentFetch({
        node: privateNode,
        path: "/healthz",
        allowPrivateHosts: false,
      }),
    ).rejects.toThrow();
  });
});

describe("mesh failure: agent server validation", () => {
  let bobDir: string;
  let bobServer: ReturnType<typeof createAgentServer>;
  let bobPort: number;
  const bobApiKey = "fail-bob-key";

  beforeAll(async () => {
    bobDir = mkdtempSync(join(tmpdir(), "fail-bob-"));
    writeCasaConfig(bobDir, "analyst", {
      port: 9999, token: "tok", workspace: "/tmp",
    });

    const acl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder@alice", "analyst", ["query"] as Capability[]);

    bobServer = createAgentServer({
      port: 0, auth: { apiKey: bobApiKey }, processManager: makePm(),
      acl, mechaDir: bobDir, nodeName: "bob",
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
  });

  it("returns 400 for invalid CASA name in query", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/casas/INVALID_NAME!/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bobApiKey}`,
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain("Invalid CASA name");
  });

  it("returns 400 for missing message field in query body", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/casas/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bobApiKey}`,
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain("message");
  });

  it("returns 400 for empty message string", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/casas/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bobApiKey}`,
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("mesh failure: rendezvous REST", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    nodes.clear(); invites.clear(); relayPairs.clear();
    server = await createServer({
      port: 0, host: "127.0.0.1",
      relayUrl: "wss://relay.test",
      secret: randomBytes(32),
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /lookup/nobody returns 404", async () => {
    const res = await fetch(`${baseUrl}/lookup/nobody`);
    expect(res.status).toBe(404);
  });
});
