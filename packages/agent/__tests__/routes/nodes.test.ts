import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerNodeRoutes } from "../../src/routes/nodes.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    nodePing: vi.fn(),
  };
});

import { nodePing } from "@mecha/service";
const mockPing = vi.mocked(nodePing);

describe("node routes", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("GET /nodes returns empty array initially", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/nodes" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("POST /nodes adds a node", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/nodes",
      payload: { name: "peer1", host: "10.0.0.1", port: 7660, apiKey: "key123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const listRes = await app.inject({ method: "GET", url: "/nodes" });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0].name).toBe("peer1");
    await app.close();
  });

  it("POST /nodes rejects missing fields", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/nodes",
      payload: { name: "peer1" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /nodes rejects invalid name", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/nodes",
      payload: { name: "bad name!", host: "10.0.0.1", port: 7660, apiKey: "k" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid node name");
    await app.close();
  });

  it("POST /nodes rejects invalid port", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/nodes",
      payload: { name: "peer1", host: "10.0.0.1", port: 99999, apiKey: "k" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("port");
    await app.close();
  });

  it("POST /nodes rejects duplicate", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({ method: "POST", url: "/nodes", payload: { name: "peer1", host: "10.0.0.1", port: 7660, apiKey: "k" } });
    const res = await app.inject({ method: "POST", url: "/nodes", payload: { name: "peer1", host: "10.0.0.2", port: 7660, apiKey: "k" } });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("DELETE /nodes/:name removes a node", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({ method: "POST", url: "/nodes", payload: { name: "peer1", host: "10.0.0.1", port: 7660, apiKey: "k" } });
    const res = await app.inject({ method: "DELETE", url: "/nodes/peer1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("DELETE /nodes/:name returns 404 for unknown", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/nodes/unknown" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE /nodes/:name returns 400 for invalid name", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/nodes/bad%20name!" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /nodes/:name/ping calls nodePing", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    mockPing.mockResolvedValue({ reachable: true, latencyMs: 42, method: "http" });
    await app.inject({ method: "POST", url: "/nodes", payload: { name: "peer1", host: "10.0.0.1", port: 7660, apiKey: "k" } });
    const res = await app.inject({ method: "POST", url: "/nodes/peer1/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.json().reachable).toBe(true);
    await app.close();
  });

  it("POST /nodes/:name/ping returns 404 for unknown node", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    mockPing.mockRejectedValue(new Error("Node not found: ghost"));
    const res = await app.inject({ method: "POST", url: "/nodes/ghost/ping" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("ghost");
    await app.close();
  });

  it("POST /nodes/:name/promote returns 404 for unknown discovered node", async () => {
    const app = Fastify();
    registerNodeRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/nodes/ghost/promote" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
