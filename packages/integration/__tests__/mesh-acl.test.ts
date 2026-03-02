/**
 * Integration tests for ACL enforcement across nodes.
 *
 * Tests real createAclEngine + real agent servers:
 * - Source-side ACL grant/revoke
 * - Destination-side ACL enforcement (expose + connect rules)
 * - Full address format (coder@alice → analyst@bob)
 * - ACL persistence to disk
 */

import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Capability, NodeEntry } from "@mecha/core";
import { createAclEngine } from "@mecha/core";
import { createAgentServer } from "@mecha/agent";
import { createCasaRouter, createLocator, agentFetch } from "@mecha/service";
import { makePm, makeMockAcl, writeCasaConfig } from "./helpers/mesh-harness.js";

// Mock forwardQueryToCasa
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    forwardQueryToCasa: vi.fn().mockResolvedValue({
      text: "acl-test-response",
      sessionId: "acl-sess",
    }),
  };
});

describe("mesh ACL: source-side enforcement", () => {
  let aliceDir: string;
  let bobDir: string;
  let bobServer: ReturnType<typeof createAgentServer>;
  let bobPort: number;
  const bobApiKey = "bob-acl-key";

  beforeAll(async () => {
    aliceDir = mkdtempSync(join(tmpdir(), "acl-alice-"));
    bobDir = mkdtempSync(join(tmpdir(), "acl-bob-"));

    writeCasaConfig(bobDir, "analyst", {
      port: 9999, token: "analyst-tok", workspace: "/tmp",
      expose: ["query"],
    });

    // Bob's server uses an open ACL (destination allows everything)
    const bobAcl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => ["query"] as Capability[],
    });
    bobAcl.grant("coder@alice", "analyst", ["query"] as Capability[]);

    bobServer = createAgentServer({
      port: 0, auth: { apiKey: bobApiKey }, processManager: makePm(),
      acl: bobAcl, mechaDir: bobDir, nodeName: "bob",
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(aliceDir, { recursive: true, force: true });
    rmSync(bobDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  function makeBobNode(): NodeEntry {
    return {
      name: "bob" as NodeEntry["name"],
      host: "127.0.0.1", port: bobPort, apiKey: bobApiKey,
      addedAt: new Date().toISOString(),
    };
  }

  it("rejects query when no ACL rule exists (source-side)", async () => {
    // Alice's ACL has NO grant for coder → analyst@bob
    const acl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query"] as Capability[],
    });
    // No grant — check should fail
    const locator = createLocator({
      mechaDir: aliceDir, pm: makePm(), getNodes: () => [makeBobNode()],
    });
    const router = createCasaRouter({
      mechaDir: aliceDir, acl, pm: makePm(), locator,
      agentFetch, sourceName: "alice", allowPrivateHosts: true,
    });

    await expect(
      router.routeQuery("coder", "analyst@bob", "hello"),
    ).rejects.toThrow("Access denied");
  });

  it("allows query after acl.grant()", async () => {
    const acl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder", "analyst@bob", ["query"] as Capability[]);

    const locator = createLocator({
      mechaDir: aliceDir, pm: makePm(), getNodes: () => [makeBobNode()],
    });
    const router = createCasaRouter({
      mechaDir: aliceDir, acl, pm: makePm(), locator,
      agentFetch, sourceName: "alice", allowPrivateHosts: true,
    });

    const result = await router.routeQuery("coder", "analyst@bob", "hello");
    expect(result.text).toBe("acl-test-response");
  });

  it("rejects query after acl.revoke()", async () => {
    const acl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder", "analyst@bob", ["query"] as Capability[]);
    acl.revoke("coder", "analyst@bob", ["query"] as Capability[]);

    const locator = createLocator({
      mechaDir: aliceDir, pm: makePm(), getNodes: () => [makeBobNode()],
    });
    const router = createCasaRouter({
      mechaDir: aliceDir, acl, pm: makePm(), locator,
      agentFetch, sourceName: "alice", allowPrivateHosts: true,
    });

    await expect(
      router.routeQuery("coder", "analyst@bob", "hello"),
    ).rejects.toThrow("Access denied");
  });

  it("rejects when granted capability does not match requested", async () => {
    const acl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query", "read_sessions"] as Capability[],
    });
    // Grant only read_sessions, not query
    acl.grant("coder", "analyst@bob", ["read_sessions"] as Capability[]);

    const check = acl.check("coder", "analyst@bob", "query" as Capability);
    expect(check.allowed).toBe(false);
  });
});

describe("mesh ACL: destination-side enforcement", () => {
  it("destination agent server denies when expose does not include query", async () => {
    const bobDir = mkdtempSync(join(tmpdir(), "acl-dest-"));
    // Write config WITHOUT expose including query
    writeCasaConfig(bobDir, "analyst", {
      port: 9999, token: "tok", workspace: "/tmp",
    });

    // Bob's ACL: no grant for coder@alice
    const bobAcl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => [] as Capability[], // expose nothing
    });
    // Even with connect rule, expose check fails
    bobAcl.grant("coder@alice", "analyst", ["query"] as Capability[]);

    const bobServer = createAgentServer({
      port: 0, auth: { apiKey: "bob-key" }, processManager: makePm(),
      acl: bobAcl, mechaDir: bobDir, nodeName: "bob",
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    const bobPort = parseInt(new URL(addr).port, 10);

    // Direct HTTP query to bob's agent server
    const res = await fetch(`http://127.0.0.1:${bobPort}/casas/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer bob-key",
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(403);

    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
  });

  it("destination agent server denies when no ACL rule on destination", async () => {
    const bobDir = mkdtempSync(join(tmpdir(), "acl-dest2-"));
    writeCasaConfig(bobDir, "analyst", {
      port: 9999, token: "tok", workspace: "/tmp",
    });

    // Bob's ACL: no rules at all
    const bobAcl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => ["query"] as Capability[],
    });

    const bobServer = createAgentServer({
      port: 0, auth: { apiKey: "bob-key" }, processManager: makePm(),
      acl: bobAcl, mechaDir: bobDir, nodeName: "bob",
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    const bobPort = parseInt(new URL(addr).port, 10);

    const res = await fetch(`http://127.0.0.1:${bobPort}/casas/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer bob-key",
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(403);

    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
  });

  it("source grant + destination deny = denied end-to-end", async () => {
    const aliceDir = mkdtempSync(join(tmpdir(), "acl-e2e-a-"));
    const bobDir = mkdtempSync(join(tmpdir(), "acl-e2e-b-"));
    writeCasaConfig(bobDir, "analyst", { port: 9999, token: "tok", workspace: "/tmp" });

    // Bob's ACL denies (no expose)
    const bobAcl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => [] as Capability[],
    });

    const bobServer = createAgentServer({
      port: 0, auth: { apiKey: "bob-key" }, processManager: makePm(),
      acl: bobAcl, mechaDir: bobDir, nodeName: "bob",
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    const bobPort = parseInt(new URL(addr).port, 10);

    // Alice has a grant
    const aliceAcl = createAclEngine({
      mechaDir: aliceDir,
      getExpose: () => ["query"] as Capability[],
    });
    aliceAcl.grant("coder", "analyst@bob", ["query"] as Capability[]);

    const locator = createLocator({
      mechaDir: aliceDir, pm: makePm(),
      getNodes: () => [{
        name: "bob" as NodeEntry["name"],
        host: "127.0.0.1", port: bobPort, apiKey: "bob-key",
        addedAt: new Date().toISOString(),
      }],
    });
    const router = createCasaRouter({
      mechaDir: aliceDir, acl: aliceAcl, pm: makePm(), locator,
      agentFetch, sourceName: "alice", allowPrivateHosts: true,
    });

    // Source-side passes, but destination-side denies → remote returns 403
    await expect(
      router.routeQuery("coder", "analyst@bob", "hello"),
    ).rejects.toThrow();

    await bobServer.close();
    rmSync(aliceDir, { recursive: true, force: true });
    rmSync(bobDir, { recursive: true, force: true });
  });
});

describe("mesh ACL: persistence", () => {
  it("save() + reload from disk preserves rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "acl-persist-"));

    const acl1 = createAclEngine({
      mechaDir: dir,
      getExpose: () => ["query"] as Capability[],
    });
    acl1.grant("coder@alice", "analyst@bob", ["query"] as Capability[]);
    acl1.save();

    // Reload from disk
    const acl2 = createAclEngine({
      mechaDir: dir,
      getExpose: () => ["query"] as Capability[],
    });
    const check = acl2.check("coder@alice", "analyst@bob", "query" as Capability);
    expect(check.allowed).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
