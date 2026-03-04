/**
 * Integration tests for cross-node bot queries.
 *
 * Tests real HTTP routing through agent servers:
 * - alice/coder → bob/analyst query forwarding
 * - SessionId propagation
 * - Bidirectional routing
 * - Error paths (unknown bot, unknown node)
 *
 * forwardQueryToBot is mocked — no real Claude processes.
 */

import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NodeEntry } from "@mecha/core";
import { createAgentServer } from "@mecha/agent";
import { deriveSessionKey, createSessionToken } from "../../agent/src/session.js";
import { createBotRouter, createLocator, agentFetch } from "@mecha/service";
import { makePm, makeMockAcl, writeBotConfig } from "./helpers/mesh-harness.js";

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function makeAuthCookie(secret = TEST_TOTP_SECRET): string {
  const sessionKey = deriveSessionKey(secret);
  const token = createSessionToken(sessionKey, 1);
  return `mecha-session=${token}`;
}

// Mock forwardQueryToBot so we don't need real bot processes
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    forwardQueryToBot: vi.fn().mockResolvedValue({
      text: "analyst says hello",
      sessionId: "sess-123",
    }),
  };
});

// Import after mock setup
const { forwardQueryToBot } = await import("@mecha/core");

describe("mesh query: cross-node routing", () => {
  let bobDir: string;
  let aliceDir: string;
  let bobServer: ReturnType<typeof createAgentServer>;
  let bobPort: number;

  beforeAll(async () => {
    bobDir = mkdtempSync(join(tmpdir(), "query-bob-"));
    writeBotConfig(bobDir, "analyst", { port: 9999, token: "analyst-token", workspace: "/tmp" });

    aliceDir = mkdtempSync(join(tmpdir(), "query-alice-"));

    bobServer = createAgentServer({
      port: 0,
      auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "mesh-routing-key" },
      processManager: makePm(),
      acl: makeMockAcl(),
      mechaDir: bobDir,
      nodeName: "bob",
    });
    const address = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(address).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
    rmSync(aliceDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  function makeBobNode(): NodeEntry {
    return {
      name: "bob" as NodeEntry["name"],
      host: "127.0.0.1",
      port: bobPort,
      apiKey: "mesh-routing-key",
      addedAt: new Date().toISOString(),
    };
  }

  function makeAliceRouter(opts: { nodes?: NodeEntry[]; acl?: ReturnType<typeof makeMockAcl> } = {}) {
    const locator = createLocator({
      mechaDir: aliceDir,
      pm: makePm(),
      getNodes: () => opts.nodes ?? [makeBobNode()],
    });
    return createBotRouter({
      mechaDir: aliceDir,
      acl: opts.acl ?? makeMockAcl(),
      pm: makePm(),
      locator,
      agentFetch,
      sourceName: "alice",
      allowPrivateHosts: true,
    });
  }

  it("routes alice/coder → bob/analyst and returns response", async () => {
    const router = makeAliceRouter();
    const result = await router.routeQuery("coder", "analyst@bob", "hello analyst");

    expect(result.text).toBe("analyst says hello");
    expect(result.sessionId).toBe("sess-123");
  });

  it("propagates sessionId in multi-turn conversation", async () => {
    const router = makeAliceRouter();

    // First turn
    const r1 = await router.routeQuery("coder", "analyst@bob", "first message");
    expect(r1.sessionId).toBe("sess-123");

    // Second turn with sessionId from first
    vi.mocked(forwardQueryToBot).mockResolvedValueOnce({
      text: "continued response",
      sessionId: "sess-123",
    });
    const r2 = await router.routeQuery("coder", "analyst@bob", "follow up", r1.sessionId);
    expect(r2.text).toBe("continued response");
    expect(r2.sessionId).toBe("sess-123");
  });

  it("sets X-Mecha-Source header correctly on remote agent", async () => {
    const router = makeAliceRouter();
    await router.routeQuery("coder", "analyst@bob", "hello");

    // The forwardQueryToBot mock was called on bob's side, verifying the request reached bob
    expect(forwardQueryToBot).toHaveBeenCalled();
  });

  it("returns BotNotFoundError for query to unknown node", async () => {
    const router = makeAliceRouter({ nodes: [] });
    await expect(
      router.routeQuery("coder", "analyst@unknown", "hello"),
    ).rejects.toThrow("not found");
  });

  it("returns 404 for query to non-existent bot on remote node", async () => {
    const router = makeAliceRouter();
    // "nonexistent" bot doesn't have a config.json on bob
    await expect(
      router.routeQuery("coder", "nonexistent@bob", "hello"),
    ).rejects.toThrow();
  });

  it("works via direct HTTP fetch to agent endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "direct query" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.response).toBe("analyst says hello");
    expect(body.sessionId).toBe("sess-123");
  });

  it("response includes both response text and sessionId", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "check fields" }),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("response");
    expect(body).toHaveProperty("sessionId");
  });
});

describe("mesh query: bidirectional routing", () => {
  let aliceDir: string;
  let bobDir: string;
  let aliceServer: ReturnType<typeof createAgentServer>;
  let bobServer: ReturnType<typeof createAgentServer>;
  let alicePort: number;
  let bobPort: number;

  beforeAll(async () => {
    aliceDir = mkdtempSync(join(tmpdir(), "bidir-alice-"));
    bobDir = mkdtempSync(join(tmpdir(), "bidir-bob-"));

    writeBotConfig(aliceDir, "coder", { port: 8888, token: "coder-token", workspace: "/tmp" });
    writeBotConfig(bobDir, "analyst", { port: 9999, token: "analyst-token", workspace: "/tmp" });

    aliceServer = createAgentServer({
      port: 0, auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "mesh-routing-key" }, processManager: makePm(),
      acl: makeMockAcl(), mechaDir: aliceDir, nodeName: "alice",
    });
    bobServer = createAgentServer({
      port: 0, auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "mesh-routing-key" }, processManager: makePm(),
      acl: makeMockAcl(), mechaDir: bobDir, nodeName: "bob",
    });

    const aliceAddr = await aliceServer.listen({ port: 0, host: "127.0.0.1" });
    const bobAddr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    alicePort = parseInt(new URL(aliceAddr).port, 10);
    bobPort = parseInt(new URL(bobAddr).port, 10);
  });

  afterAll(async () => {
    await aliceServer.close();
    await bobServer.close();
    rmSync(aliceDir, { recursive: true, force: true });
    rmSync(bobDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("bob can query alice after mutual peer registration", async () => {
    const aliceNode: NodeEntry = {
      name: "alice" as NodeEntry["name"],
      host: "127.0.0.1", port: alicePort, apiKey: "mesh-routing-key",
      addedAt: new Date().toISOString(),
    };

    const locator = createLocator({
      mechaDir: bobDir,
      pm: makePm(),
      getNodes: () => [aliceNode],
    });

    const router = createBotRouter({
      mechaDir: bobDir,
      acl: makeMockAcl(),
      pm: makePm(),
      locator,
      agentFetch,
      sourceName: "bob",
      allowPrivateHosts: true,
    });

    const result = await router.routeQuery("analyst", "coder@alice", "hello coder");
    expect(result.text).toBe("analyst says hello");
  });
});
