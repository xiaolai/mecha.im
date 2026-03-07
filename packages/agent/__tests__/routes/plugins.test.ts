import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerPluginRoutes } from "../../src/routes/plugins.js";

describe("plugin routes", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-plugin-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("GET /plugins returns empty initially", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/plugins" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("POST /plugins adds an http plugin", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "web-search", type: "http", url: "http://localhost:3000" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: "GET", url: "/plugins" });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].name).toBe("web-search");
    expect(list.json()[0].config.type).toBe("http");
    await app.close();
  });

  it("POST /plugins adds an sse plugin", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "my-sse", type: "sse", url: "http://localhost:4000/sse" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("POST /plugins adds a stdio plugin", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "local-tool", type: "stdio", command: "node", args: ["server.js"] },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/plugins" });
    const plugin = list.json()[0];
    expect(plugin.config.type).toBe("stdio");
    expect(plugin.config.command).toBe("node");
    expect(plugin.config.args).toEqual(["server.js"]);
    await app.close();
  });

  it("POST /plugins rejects missing name", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { type: "http", url: "http://localhost" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name");
    await app.close();
  });

  it("POST /plugins rejects missing type", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /plugins rejects http without url", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "test", type: "http" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /plugins rejects stdio without command", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "test", type: "stdio" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /plugins rejects invalid type", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "test", type: "grpc" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /plugins rejects duplicate name without force", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "dupe", type: "http", url: "http://localhost:3000" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "dupe", type: "http", url: "http://localhost:3001" },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("POST /plugins allows force overwrite", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "dupe", type: "http", url: "http://localhost:3000" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "dupe", type: "http", url: "http://localhost:3001", force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("DELETE /plugins/:name removes a plugin", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "test-plugin", type: "http", url: "http://localhost" },
    });
    const res = await app.inject({ method: "DELETE", url: "/plugins/test-plugin" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: "GET", url: "/plugins" });
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("DELETE /plugins/:name returns 404 for unknown", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/plugins/unknown" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /plugins/:name/status returns plugin config", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "my-http", type: "http", url: "http://localhost:5000", description: "My HTTP plugin" },
    });
    const res = await app.inject({ method: "GET", url: "/plugins/my-http/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("my-http");
    expect(body.config.type).toBe("http");
    expect(body.config.url).toBe("http://localhost:5000");
    expect(body.config.description).toBe("My HTTP plugin");
    await app.close();
  });

  it("GET /plugins/:name/status returns 404 for unknown", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/plugins/nope/status" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /plugins/:name/test returns 404 for unknown", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/plugins/nope/test" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /plugins/:name/test for stdio returns ok with command", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "my-stdio", type: "stdio", command: "/usr/bin/node" },
    });
    const res = await app.inject({ method: "POST", url: "/plugins/my-stdio/test" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("/usr/bin/node");
    await app.close();
  });

  it("POST /plugins/:name/test blocks hostname resolving to private IP (SSRF)", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "ssrf-dns", type: "http", url: "http://localhost:19999" },
    });
    const res = await app.inject({ method: "POST", url: "/plugins/ssrf-dns/test" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Cannot test plugins targeting private/internal addresses");
    await app.close();
  });

  it("POST /plugins/:name/test for http rejects private/internal URLs", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/plugins",
      payload: { name: "bad-http", type: "http", url: "http://127.0.0.1:19999" },
    });
    const res = await app.inject({ method: "POST", url: "/plugins/bad-http/test" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Cannot test plugins targeting private/internal addresses");
    await app.close();
  });

  it("POST /plugins with optional env and headers", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: {
        name: "full-plugin",
        type: "http",
        url: "http://localhost:8080",
        headers: { Authorization: "Bearer token" },
        description: "Full HTTP plugin",
      },
    });
    expect(res.statusCode).toBe(200);

    const status = await app.inject({ method: "GET", url: "/plugins/full-plugin/status" });
    const cfg = status.json().config;
    expect(cfg.headers).toEqual({ Authorization: "***" });
    expect(cfg.description).toBe("Full HTTP plugin");
    await app.close();
  });

  it("POST /plugins with stdio env", async () => {
    const app = Fastify();
    registerPluginRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/plugins",
      payload: {
        name: "env-plugin",
        type: "stdio",
        command: "python",
        args: ["-m", "server"],
        env: { API_KEY: "secret" },
      },
    });
    expect(res.statusCode).toBe(200);

    const status = await app.inject({ method: "GET", url: "/plugins/env-plugin/status" });
    const cfg = status.json().config;
    expect(cfg.env).toEqual({ API_KEY: "***" });
    expect(cfg.args).toEqual(["-m", "server"]);
    await app.close();
  });
});
