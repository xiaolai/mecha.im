import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerDiscoverRoutes } from "../src/routes/discover.js";
import { registerCasaRoutes } from "../src/routes/casas.js";
import { registerHealthRoutes } from "../src/routes/health.js";
import { registerRoutingRoutes } from "../src/routes/routing.js";
import type { CasaName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { writeCasaConfig, makeAcl } from "../../core/__tests__/test-utils.js";
import { makePm } from "../../service/__tests__/test-utils.js";

describe("agent routes", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("health routes", () => {
    it("returns node name and status", async () => {
      const app = Fastify();
      registerHealthRoutes(app, { nodeName: "bob", port: 7660 });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok", node: "bob" });
      await app.close();
    });
  });

  describe("discover routes", () => {
    it("returns empty when no CASAs", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-discover-"));
      const app = Fastify();
      registerDiscoverRoutes(app, { mechaDir, pm: makePm() });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/discover" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it("handles CASA with no config file", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-discover-"));
      const list: ProcessInfo[] = [
        { name: "ghost" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = Fastify();
      registerDiscoverRoutes(app, { mechaDir, pm: makePm(list) });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/discover" });
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].tags).toEqual([]);
      expect(body[0].expose).toEqual([]);
      await app.close();
    });

    it("handles malformed tags in config", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-discover-"));
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      writeCasaConfig(mechaDir, "coder", {
        port: 7700,
        token: "t",
        workspace: "/ws",
        tags: "not-an-array" as any,
        expose: 123 as any,
      });
      const app = Fastify();
      registerDiscoverRoutes(app, { mechaDir, pm: makePm(list) });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/discover" });
      const body = res.json();
      expect(body).toHaveLength(1);
      // readCasaConfig normalizes invalid tags/expose to undefined → discover treats as []
      expect(body[0].tags).toEqual([]);
      expect(body[0].expose).toEqual([]);
      await app.close();
    });

    it("filters by both tag and capability", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-discover-"));
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/a" },
        { name: "writer" as CasaName, state: "running", port: 7701, workspacePath: "/b" },
      ];
      writeCasaConfig(mechaDir, "coder", {
        port: 7700, token: "t", workspace: "/a", tags: ["code"], expose: ["query"],
      });
      writeCasaConfig(mechaDir, "writer", {
        port: 7701, token: "t", workspace: "/b", tags: ["code"], expose: ["write"],
      });
      const app = Fastify();
      registerDiscoverRoutes(app, { mechaDir, pm: makePm(list) });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/discover?tag=code&capability=query",
      });
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("coder");
      await app.close();
    });
  });

  describe("casa routes", () => {
    it("returns empty list", async () => {
      const app = Fastify();
      registerCasaRoutes(app, makePm());
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it("returns CASA list with name, state, port", async () => {
      const list: ProcessInfo[] = [
        { name: "a" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        { name: "b" as CasaName, state: "stopped", workspacePath: "/ws2" },
      ];
      const app = Fastify();
      registerCasaRoutes(app, makePm(list));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas" });
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0]).toEqual({ name: "a", state: "running", port: 7700 });
      // token and workspacePath should NOT be exposed
      expect(body[0].token).toBeUndefined();
      await app.close();
    });
  });

  describe("routing routes", () => {
    it("validates CASA name format", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-routing-"));
      const app = Fastify();
      registerRoutingRoutes(app, { mechaDir, acl: makeAcl() });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/casas/INVALID_NAME/query",
        headers: { "x-mecha-source": "coder" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid CASA name");
      await app.close();
    });

    it("returns 502 on forwarding failure", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-routing-"));
      writeCasaConfig(mechaDir, "target", {
        port: 7700, token: "tok", workspace: "/ws", expose: ["query"],
      });
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      const app = Fastify();
      registerRoutingRoutes(app, { mechaDir, acl: makeAcl() });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/casas/target/query",
        headers: { "x-mecha-source": "coder@remote" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(502);
      await app.close();
    });
  });
});
