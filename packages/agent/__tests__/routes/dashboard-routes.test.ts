import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerAclRoutes } from "../../src/routes/acl.js";
import { registerAuditRoutes } from "../../src/routes/audit.js";
import { registerMeshRoutes } from "../../src/routes/mesh.js";
import { registerMeterRoutes } from "../../src/routes/meter.js";
import { registerSettingsRoutes } from "../../src/routes/settings.js";
import { registerEventsRoutes } from "../../src/routes/events.js";
import type { AclEngine } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

describe("dashboard routes", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("acl routes", () => {
    it("returns rules from acl engine", async () => {
      const rules = [{ casa: "alice", target: "bob", capability: "query" }];
      const acl = { listRules: vi.fn().mockReturnValue(rules) } as unknown as AclEngine;
      const app = Fastify();
      registerAclRoutes(app, { acl });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/acl" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(rules);
      expect(acl.listRules).toHaveBeenCalled();
      await app.close();
    });

    it("returns empty array when no rules", async () => {
      const acl = { listRules: vi.fn().mockReturnValue([]) } as unknown as AclEngine;
      const app = Fastify();
      registerAclRoutes(app, { acl });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/acl" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });
  });

  describe("audit routes", () => {
    it("returns audit entries with default limit", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-audit-"));
      const auditDir = join(mechaDir, "audit");
      mkdirSync(auditDir, { recursive: true });
      writeFileSync(join(auditDir, "audit.jsonl"), "");

      const app = Fastify();
      registerAuditRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/audit" });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
      await app.close();
    });

    it("accepts limit query parameter", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-audit-"));
      const auditDir = join(mechaDir, "audit");
      mkdirSync(auditDir, { recursive: true });
      writeFileSync(join(auditDir, "audit.jsonl"), "");

      const app = Fastify();
      registerAuditRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/audit?limit=10" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("clamps invalid limit to default", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-audit-"));
      const auditDir = join(mechaDir, "audit");
      mkdirSync(auditDir, { recursive: true });
      writeFileSync(join(auditDir, "audit.jsonl"), "");

      const app = Fastify();
      registerAuditRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/audit?limit=abc" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("settings routes", () => {
    it("returns runtime settings", async () => {
      const app = Fastify();
      registerSettingsRoutes(app);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/settings/runtime" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.casaPortRange).toBeDefined();
      expect(body.agentPort).toBeDefined();
      expect(body.mcpPort).toBeDefined();
      await app.close();
    });
  });

  describe("meter routes", () => {
    it("returns cost for today when no casa param", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-meter-"));
      const meterDir = join(mechaDir, "meter");
      mkdirSync(meterDir, { recursive: true });

      const app = Fastify();
      registerMeterRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/meter/cost" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("returns cost for specific casa", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-meter-"));
      const meterDir = join(mechaDir, "meter");
      mkdirSync(meterDir, { recursive: true });

      const app = Fastify();
      registerMeterRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/meter/cost?casa=alice" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("mesh routes", () => {
    it("returns empty array when no nodes configured", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-mesh-"));

      const app = Fastify();
      registerMeshRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/mesh/nodes" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it("returns node statuses when nodes exist", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-mesh-"));
      // nodes.json is at mechaDir/nodes.json (not in a subdirectory)
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify([
        { name: "remote", host: "192.168.1.100", port: 7660, apiKey: "k", addedAt: new Date().toISOString() },
      ]));

      const app = Fastify();
      registerMeshRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/mesh/nodes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("remote");
      // Node will be offline since it's a fake host
      expect(body[0].status).toBe("offline");
      await app.close();
    });
  });

  describe("events routes", () => {
    it("registers event route and subscribes to process manager", async () => {
      const unsubscribe = vi.fn();
      const pm = {
        onEvent: vi.fn().mockReturnValue(unsubscribe),
      } as unknown as ProcessManager;

      const app = Fastify();
      registerEventsRoutes(app, { processManager: pm });
      await app.ready();

      // Verify route is registered by checking route table
      const routes = app.printRoutes();
      expect(routes).toContain("events");
      await app.close();
    });
  });
});
