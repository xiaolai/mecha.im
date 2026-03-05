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
        tailscaleIp: "100.100.1.9",
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
        tailscaleIp: "100.100.1.99",
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
        tailscaleIp: "100.100.1.1",
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
