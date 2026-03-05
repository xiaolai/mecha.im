import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      const rules = [{ bot: "alice", target: "bob", capability: "query" }];
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
    let savedClusterKey: string | undefined;
    beforeEach(() => {
      savedClusterKey = process.env.MECHA_CLUSTER_KEY;
      delete process.env.MECHA_CLUSTER_KEY;
    });
    afterEach(() => {
      if (savedClusterKey !== undefined) process.env.MECHA_CLUSTER_KEY = savedClusterKey;
      else delete process.env.MECHA_CLUSTER_KEY;
    });

    it("returns runtime settings", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/settings/runtime" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.botPortRange).toBeDefined();
      expect(body.agentPort).toBeDefined();
      expect(body.mcpPort).toBeDefined();
      expect(body.discovery).toBeDefined();
      expect(body.discovery.enabled).toBe(false);
      expect(body.discovery.discoveredCount).toBe(0);
      expect(body.discovery.manualCount).toBe(0);
      await app.close();
    });

    it("returns TOTP status", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/settings/totp" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(false);
      expect(body.source).toBeNull();
      await app.close();
    });

    it("returns TOTP configured from file", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      writeFileSync(join(mechaDir, "totp-secret"), "JBSWY3DPEHPK3PXP\n");
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/settings/totp" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.source).toBe("file");
      await app.close();
    });

    it("returns auth profiles (empty)", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/settings/auth-profiles" });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
      await app.close();
    });

    it("sets default profile on valid request", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const authDir = join(mechaDir, "auth");
      mkdirSync(authDir, { recursive: true });
      writeFileSync(join(authDir, "profiles.json"), JSON.stringify({
        default: "main",
        profiles: {
          main: { type: "api-key", account: null, label: "Main", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
          alt: { type: "api-key", account: null, label: "Alt", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
        },
      }));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/settings/auth-profiles/default",
        payload: { name: "alt" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      await app.close();
    });

    it("deletes a stored profile", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const authDir = join(mechaDir, "auth");
      mkdirSync(authDir, { recursive: true });
      writeFileSync(join(authDir, "profiles.json"), JSON.stringify({
        default: "main",
        profiles: {
          main: { type: "api-key", account: null, label: "Main", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
          removeme: { type: "api-key", account: null, label: "Remove", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
        },
      }));
      writeFileSync(join(authDir, "credentials.json"), JSON.stringify({
        main: { token: "tok1" },
        removeme: { token: "tok2" },
      }));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({
        method: "DELETE",
        url: "/settings/auth-profiles/removeme",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      await app.close();
    });

    it("rejects set-default with missing body", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/settings/auth-profiles/default",
        payload: {},
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/invalid/i);
      await app.close();
    });

    it("rejects delete of env-prefixed profile", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-settings-"));
      const app = Fastify();
      registerSettingsRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({
        method: "DELETE",
        url: "/settings/auth-profiles/$env:api-key",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/cannot remove|environment/i);
      await app.close();
    });
  });

  describe("meter routes", () => {
    it("returns cost for today when no bot param", async () => {
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

    it("returns cost for specific bot", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-meter-"));
      const meterDir = join(mechaDir, "meter");
      mkdirSync(meterDir, { recursive: true });

      const app = Fastify();
      registerMeterRoutes(app, { mechaDir });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/meter/cost?bot=alice" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("mesh routes", () => {
    it("returns local node when no remote nodes configured", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-mesh-"));
      const pm = { list: vi.fn().mockReturnValue([
        { name: "a", state: "running", port: 7700, workspacePath: "/ws" },
        { name: "b", state: "stopped", workspacePath: "/ws2" },
      ]) } as unknown as ProcessManager;

      const app = Fastify();
      registerMeshRoutes(app, { mechaDir, nodeName: "local-test", processManager: pm, port: 7660, startedAt: "2026-03-02T12:00:00.000Z" });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/mesh/nodes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("local-test");
      expect(body[0].status).toBe("online");
      expect(body[0].isLocal).toBe(true);
      expect(body[0].latencyMs).toBe(0);
      expect(body[0].botCount).toBe(1);
      // New fields from collectNodeInfo
      expect(body[0].hostname).toBeDefined();
      expect(body[0].platform).toBeDefined();
      expect(body[0].arch).toBeDefined();
      expect(body[0].cpuCount).toBeGreaterThan(0);
      expect(body[0].totalMemMB).toBeGreaterThan(0);
      expect(body[0].port).toBe(7660);
      expect(body[0].startedAt).toBe("2026-03-02T12:00:00.000Z");
      await app.close();
    });

    it("returns local node plus remote node statuses", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-mesh-"));
      const pm = { list: vi.fn().mockReturnValue([]) } as unknown as ProcessManager;
      // nodes.json is at mechaDir/nodes.json (not in a subdirectory)
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify([
        { name: "remote", host: "192.168.1.100", port: 7660, apiKey: "k", addedAt: new Date().toISOString() },
      ]));

      const app = Fastify();
      registerMeshRoutes(app, { mechaDir, nodeName: "local-test", processManager: pm, port: 7660, startedAt: "2026-03-02T12:00:00.000Z" });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/mesh/nodes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("local-test");
      expect(body[0].status).toBe("online");
      expect(body[0].isLocal).toBe(true);
      expect(body[0].hostname).toBeDefined();
      expect(body[1].name).toBe("remote");
      // Remote node will be offline since it's a fake host
      expect(body[1].status).toBe("offline");
      expect(body[1].isLocal).toBeUndefined();
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
