import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerToolRoutes } from "../../src/routes/tools.js";

describe("tool routes", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("GET /tools returns empty initially", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/tools" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("POST /tools installs a tool", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/tools",
      payload: { name: "web-search", version: "1.0.0", description: "Search the web" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().tool.name).toBe("web-search");

    const list = await app.inject({ method: "GET", url: "/tools" });
    expect(list.json()).toHaveLength(1);
    await app.close();
  });

  it("POST /tools rejects missing name", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/tools", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /tools rejects invalid name", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/tools",
      payload: { name: "../etc" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE /tools/:name removes a tool", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({ method: "POST", url: "/tools", payload: { name: "my-tool" } });
    const res = await app.inject({ method: "DELETE", url: "/tools/my-tool" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: "GET", url: "/tools" });
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("DELETE /tools/:name returns 404 for unknown", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/tools/unknown" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /tools rejects non-string name", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/tools",
      payload: { name: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name is required");
    await app.close();
  });

  it("POST /tools rejects non-string version", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/tools",
      payload: { name: "valid-tool", version: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("version must be a string");
    await app.close();
  });

  it("POST /tools rejects non-string description", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/tools",
      payload: { name: "valid-tool", description: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("description must be a string");
    await app.close();
  });

  it("GET /tools/runtime returns claude runtime info", async () => {
    const app = Fastify();
    registerToolRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/tools/runtime" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("binPath");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("resolvedFrom");
    await app.close();
  });
});
