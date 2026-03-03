import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    readAuthProfiles: vi.fn().mockReturnValue({ default: null, profiles: {} }),
  };
});

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaConfigure: vi.fn(),
    checkCasaBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
    getCachedSnapshot: vi.fn().mockReturnValue(null),
  };
});

import { readAuthProfiles } from "@mecha/core";
import { casaConfigure, checkCasaBusy, getCachedSnapshot } from "@mecha/service";
const mockReadAuthProfiles = vi.mocked(readAuthProfiles);
const mockCasaConfigure = vi.mocked(casaConfigure);
const mockCheckBusy = vi.mocked(checkCasaBusy);
const mockGetSnapshot = vi.mocked(getCachedSnapshot);

describe("agent routes", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    mockCheckBusy.mockResolvedValue({ busy: false, activeSessions: 0 });
    mockReadAuthProfiles.mockReturnValue({ default: null, profiles: {} });
    mockCasaConfigure.mockReset();
  });

  describe("health routes", () => {
    it("returns minimal status on public /healthz", async () => {
      const app = Fastify();
      registerHealthRoutes(app, {
        nodeName: "bob",
        port: 7660,
        processManager: makePm(),
        startedAt: "2026-03-02T12:00:00.000Z",
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ status: "ok", node: "bob" });
      // Should NOT leak system info
      expect(body.hostname).toBeUndefined();
      expect(body.lanIp).toBeUndefined();
      await app.close();
    });

    it("returns full system info on /node/info", async () => {
      const list: ProcessInfo[] = [
        { name: "a" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        { name: "b" as CasaName, state: "stopped", workspacePath: "/ws2" },
      ];
      const app = Fastify();
      registerHealthRoutes(app, {
        nodeName: "bob",
        port: 7660,
        processManager: makePm(list),
        startedAt: "2026-03-02T12:00:00.000Z",
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/node/info" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.node).toBe("bob");
      expect(body.hostname).toBeDefined();
      expect(body.platform).toBeDefined();
      expect(body.arch).toBeDefined();
      expect(body.port).toBe(7660);
      expect(body.startedAt).toBe("2026-03-02T12:00:00.000Z");
      expect(body.cpuCount).toBeGreaterThan(0);
      expect(body.totalMemMB).toBeGreaterThan(0);
      expect(body.casaCount).toBe(1); // only "a" is running
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
    beforeEach(() => {
      mechaDir = mkdtempSync(join(tmpdir(), "agent-casas-"));
    });

    it("returns empty list", async () => {
      const app = Fastify();
      registerCasaRoutes(app, makePm(), mechaDir);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it("returns enriched CASA list with projection", async () => {
      const list: ProcessInfo[] = [
        { name: "a" as CasaName, state: "running", port: 7700, workspacePath: "/home/user/project", token: "secret", pid: 1234 },
        { name: "b" as CasaName, state: "stopped", workspacePath: "/ws2" },
      ];
      writeCasaConfig(mechaDir, "a", {
        port: 7700, token: "tok", workspace: "/home/user/project",
        model: "claude-sonnet-4-20250514", tags: ["coder"],
      });
      const app = Fastify();
      registerCasaRoutes(app, makePm(list), mechaDir);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas" });
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("a");
      expect(body[0].state).toBe("running");
      expect(body[0].port).toBe(7700);
      expect(body[0].workspacePath).toBe("project");
      expect(body[0].model).toBe("claude-sonnet-4-20250514");
      expect(body[0].tags).toEqual(["coder"]);
      expect(body[0].token).toBeUndefined();
      expect(body[0].pid).toBeUndefined();
      await app.close();
    });

    it("includes costToday when snapshot has data", async () => {
      const list: ProcessInfo[] = [
        { name: "a" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const emptySummary = {
        requests: 0, errors: 0, inputTokens: 0, outputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, avgLatencyMs: 0,
      };
      mockGetSnapshot.mockReturnValueOnce({
        ts: "2026-03-02T12:00:00Z", date: "2026-03-02",
        global: { today: emptySummary, thisMonth: emptySummary },
        byCasa: { a: { today: { ...emptySummary, costUsd: 2.50 }, thisMonth: emptySummary } },
        byAuth: {}, byTag: {},
      });
      const app = Fastify();
      registerCasaRoutes(app, makePm(list), mechaDir);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas" });
      expect(res.json()[0].costToday).toBe(2.50);
      await app.close();
    });

    describe("POST /casas/:name/start", () => {
      it("starts a stopped CASA from config", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "stopped", workspacePath: "/ws" },
        ]);
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/start" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, name: "alice", port: 7700 });
        expect(pm.spawn).toHaveBeenCalled();
        await app.close();
      });

      it("returns 409 when CASA is already running", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/start" });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("CASA_ALREADY_RUNNING");
        await app.close();
      });

      it("returns 404 when no config exists", async () => {
        const app = Fastify();
        registerCasaRoutes(app, makePm(), mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/ghost/start" });
        expect(res.statusCode).toBe(404);
        await app.close();
      });

      it("returns 400 for invalid name", async () => {
        const app = Fastify();
        registerCasaRoutes(app, makePm(), mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/INVALID/start" });
        expect(res.statusCode).toBe(400);
        await app.close();
      });
    });

    describe("POST /casas/:name/restart", () => {
      it("restarts a running CASA that is not busy", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/restart" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, name: "alice", port: 7700 });
        expect(pm.stop).toHaveBeenCalledWith("alice");
        expect(pm.spawn).toHaveBeenCalled();
        await app.close();
      });

      it("returns 409 when CASA is busy and force not set", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 2, lastActivity: "2026-03-02T12:00:00Z",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/restart" });
        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body.code).toBe("CASA_BUSY");
        expect(body.activeSessions).toBe(2);
        expect(body.lastActivity).toBe("2026-03-02T12:00:00Z");
        await app.close();
      });

      it("restarts busy CASA when force=true", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 2, lastActivity: "2026-03-02T12:00:00Z",
        });
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "POST",
          url: "/casas/alice/restart",
          payload: { force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(pm.kill).toHaveBeenCalledWith("alice");
        await app.close();
      });

      it("starts a stopped CASA via restart", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "stopped", workspacePath: "/ws" },
        ]);
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/restart" });
        expect(res.statusCode).toBe(200);
        expect(pm.stop).not.toHaveBeenCalled();
        expect(pm.spawn).toHaveBeenCalled();
        await app.close();
      });

      it("returns 404 when no config exists", async () => {
        const app = Fastify();
        registerCasaRoutes(app, makePm(), mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/ghost/restart" });
        expect(res.statusCode).toBe(404);
        await app.close();
      });
    });

    describe("POST /casas/:name/stop (task check)", () => {
      it("stops a non-busy CASA", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/stop" });
        expect(res.statusCode).toBe(200);
        expect(pm.stop).toHaveBeenCalledWith("alice");
        await app.close();
      });

      it("returns 409 when busy and force not set", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 1, lastActivity: "2026-03-02T12:00:00Z",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/stop" });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("CASA_BUSY");
        expect(pm.stop).not.toHaveBeenCalled();
        await app.close();
      });

      it("stops busy CASA when force=true", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 1,
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "POST",
          url: "/casas/alice/stop",
          payload: { force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(pm.stop).toHaveBeenCalledWith("alice");
        await app.close();
      });

      it("returns 409 when CASA is not running", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "stopped", workspacePath: "/ws" },
        ]);
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/casas/alice/stop" });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("CASA_NOT_RUNNING");
        await app.close();
      });

      it("treats non-boolean force as false", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 1, lastActivity: "2026-03-02T12:00:00Z",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "POST",
          url: "/casas/alice/stop",
          payload: { force: "yes" },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("CASA_BUSY");
        expect(pm.stop).not.toHaveBeenCalled();
        await app.close();
      });
    });

    describe("PATCH /casas/:name/config", () => {
      it("updates config fields without restart", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { model: "claude-haiku-4-5-20251001", tags: ["coder"] },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, restarted: false });
        expect(mockCasaConfigure).toHaveBeenCalledWith(
          mechaDir, pm, "alice",
          { model: "claude-haiku-4-5-20251001", tags: ["coder"] },
        );
        await app.close();
      });

      it("updates and restarts when restart=true", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { model: "claude-haiku-4-5-20251001", restart: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, restarted: true });
        expect(pm.stop).toHaveBeenCalledWith("alice");
        expect(pm.spawn).toHaveBeenCalled();
        await app.close();
      });

      it("force-restarts with kill when force=true", async () => {
        writeCasaConfig(mechaDir, "alice", {
          port: 7700, token: "tok", workspace: "/ws",
        });
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 1, lastActivity: "2026-03-02T12:00:00Z",
        });
        vi.mocked(pm.spawn).mockResolvedValue({
          name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { model: "claude-haiku-4-5-20251001", restart: true, force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, restarted: true });
        expect(pm.kill).toHaveBeenCalledWith("alice");
        await app.close();
      });

      it("returns 400 for invalid CASA name", async () => {
        const app = Fastify();
        registerCasaRoutes(app, makePm(), mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/INVALID/config",
          payload: { model: "claude-haiku-4-5-20251001" },
        });
        expect(res.statusCode).toBe(400);
        await app.close();
      });

      it("returns 404 when CASA not found", async () => {
        const app = Fastify();
        registerCasaRoutes(app, makePm(), mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/ghost/config",
          payload: { model: "claude-haiku-4-5-20251001" },
        });
        expect(res.statusCode).toBe(404);
        await app.close();
      });

      it("returns 400 for invalid auth profile", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockReadAuthProfiles.mockReturnValue({
          default: null,
          profiles: { existing: { type: "oauth", addedAt: "2026-01-01T00:00:00Z" } },
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { auth: "nonexistent" },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("Auth profile not found");
        await app.close();
      });

      it("returns 409 when busy CASA + restart without force", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
        ]);
        mockCheckBusy.mockResolvedValue({
          busy: true, activeSessions: 2, lastActivity: "2026-03-02T12:00:00Z",
        });
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { model: "claude-haiku-4-5-20251001", restart: true },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("CASA_BUSY");
        // Config should still have been updated before the busy check
        expect(mockCasaConfigure).toHaveBeenCalled();
        await app.close();
      });

      it("skips restart when CASA is stopped", async () => {
        const pm = makePm([
          { name: "alice" as CasaName, state: "stopped", workspacePath: "/ws" },
        ]);
        const app = Fastify();
        registerCasaRoutes(app, pm, mechaDir);
        await app.ready();

        const res = await app.inject({
          method: "PATCH",
          url: "/casas/alice/config",
          payload: { model: "claude-haiku-4-5-20251001", restart: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, restarted: false });
        expect(pm.stop).not.toHaveBeenCalled();
        expect(pm.spawn).not.toHaveBeenCalled();
        await app.close();
      });
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
