import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CasaName, NodeEntry } from "@mecha/core";
import { createAgentServer } from "@mecha/agent";
import { createCasaRouter } from "../src/router.js";
import { createLocator } from "../src/locator.js";
import { agentFetch } from "../src/agent-fetch.js";
import { makeAcl } from "../../core/__tests__/test-utils.js";
import { makePm } from "./test-utils.js";

/**
 * End-to-end mesh integration test.
 *
 * Simulates two nodes (alice, bob):
 * - bob runs an agent server on a random port
 * - alice uses CasaRouter + locator + agentFetch to route a query
 *   from alice's CASA "coder" → bob's CASA "analyst"
 *
 * forwardQueryToCasa is mocked (no real CASA processes), but the HTTP
 * chain through agentFetch → agent server → routing route is real.
 */

// Mock forwardQueryToCasa so we don't need a real CASA process
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    forwardQueryToCasa: vi.fn().mockResolvedValue({
      text: "analyst says hello",
      sessionId: "sess-123",
    }),
  };
});

describe("mesh e2e: cross-node query", () => {
  let bobDir: string;
  let aliceDir: string;
  let bobServer: Awaited<ReturnType<typeof createAgentServer>>;
  let bobPort: number;
  const bobApiKey = "bob-secret-key";

  beforeAll(async () => {
    // Set up bob's mecha dir with an "analyst" CASA config
    bobDir = mkdtempSync(join(tmpdir(), "mesh-e2e-bob-"));
    const analystDir = join(bobDir, "analyst");
    mkdirSync(analystDir, { recursive: true });
    writeFileSync(
      join(analystDir, "config.json"),
      JSON.stringify({ port: 9999, token: "analyst-token", workspace: "/tmp" }),
    );

    // Set up alice's mecha dir (empty — alice's CASAs don't need to exist for outbound routing)
    aliceDir = mkdtempSync(join(tmpdir(), "mesh-e2e-alice-"));

    // Start bob's agent server
    bobServer = createAgentServer({
      port: 0, // will be overridden by listen
      apiKey: bobApiKey,
      processManager: makePm(),
      acl: makeAcl(),
      mechaDir: bobDir,
      nodeName: "bob",
    });

    // Listen on a random available port
    const address = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(address).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
    rmSync(aliceDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("routes a query from alice/coder to bob/analyst via HTTP", async () => {
    const bobNode: NodeEntry = {
      name: "bob" as NodeEntry["name"],
      host: "127.0.0.1",
      port: bobPort,
      apiKey: bobApiKey,
      addedAt: new Date().toISOString(),
    };

    // Alice's locator: "analyst@bob" → remote bob node
    const locator = createLocator({
      mechaDir: aliceDir,
      pm: makePm(),
      getNodes: () => [bobNode],
    });

    // Alice's router with locator + real agentFetch
    const router = createCasaRouter({
      mechaDir: aliceDir,
      acl: makeAcl(),
      pm: makePm(),
      locator,
      agentFetch,
      sourceName: "alice",
      allowPrivateHosts: true,
    });

    const result = await router.routeQuery("coder", "analyst@bob", "hello analyst");

    expect(result.text).toBe("analyst says hello");
    expect(result.sessionId).toBe("sess-123");
  });

  it("rejects unauthorized cross-node queries via ACL", async () => {
    const bobNode: NodeEntry = {
      name: "bob" as NodeEntry["name"],
      host: "127.0.0.1",
      port: bobPort,
      apiKey: bobApiKey,
      addedAt: new Date().toISOString(),
    };

    const locator = createLocator({
      mechaDir: aliceDir,
      pm: makePm(),
      getNodes: () => [bobNode],
    });

    // Alice's ACL denies the query
    const router = createCasaRouter({
      mechaDir: aliceDir,
      acl: makeAcl({ check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }) }),
      pm: makePm(),
      locator,
      agentFetch,
      sourceName: "alice",
      allowPrivateHosts: true,
    });

    await expect(
      router.routeQuery("coder", "analyst@bob", "hello"),
    ).rejects.toThrow("Access denied");
  });

  it("returns CasaNotFoundError when target node is unknown", async () => {
    // No nodes registered — bob is unknown
    const locator = createLocator({
      mechaDir: aliceDir,
      pm: makePm(),
      getNodes: () => [],
    });

    const router = createCasaRouter({
      mechaDir: aliceDir,
      acl: makeAcl(),
      pm: makePm(),
      locator,
      agentFetch,
      sourceName: "alice",
    });

    await expect(
      router.routeQuery("coder", "analyst@unknown", "hello"),
    ).rejects.toThrow("not found");
  });
});
