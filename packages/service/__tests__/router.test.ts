import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCasaRouter } from "../src/router.js";
import type { AclEngine, CasaName, Capability } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function writeCasaConfig(mechaDir: string, name: string, cfg: Record<string, unknown>): void {
  const dir = join(mechaDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}

function makeAcl(overrides: Partial<AclEngine> = {}): AclEngine {
  return {
    grant: vi.fn(),
    revoke: vi.fn(),
    check: vi.fn().mockReturnValue({ allowed: true }),
    listRules: vi.fn().mockReturnValue([]),
    listConnections: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    ...overrides,
  } as unknown as AclEngine;
}

function makePm(list: ProcessInfo[] = []): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue(list),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

describe("createCasaRouter", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  describe("routeQuery", () => {
    it("throws AclDeniedError when ACL denies", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl({ check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }) });
      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });

      await expect(
        router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello"),
      ).rejects.toThrow(/Access denied/);
    });

    it("throws CasaNotFoundError when target config missing", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });

      await expect(
        router.routeQuery("coder" as CasaName, "ghost" as CasaName, "hello"),
      ).rejects.toThrow(/not found/i);
    });

    it("makes HTTP request to target on success", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok123", workspace: "/ws" });
      const acl = makeAcl();

      // Mock global fetch
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "I found 3 papers" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "find papers");

      expect(result).toBe("I found 3 papers");
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:7700/api/chat",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer tok123",
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it("throws when target returns non-OK", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("error", { status: 500 }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      await expect(
        router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello"),
      ).rejects.toThrow(/returned HTTP 500/);

      fetchSpy.mockRestore();
    });

    it("returns JSON stringified when response.response is not a string", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [1, 2, 3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello");
      expect(result).toContain('"data"');

      fetchSpy.mockRestore();
    });

    it("returns text when response is not JSON", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("plain text response", { status: 200, headers: { "content-type": "text/plain" } }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello");
      expect(result).toBe("plain text response");

      fetchSpy.mockRestore();
    });
  });

  describe("routeDiscover", () => {
    it("returns CASAs excluding source", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "coder", { port: 7701, token: "t", workspace: "/a", tags: ["code"] });
      writeCasaConfig(mechaDir, "researcher", { port: 7702, token: "t", workspace: "/b", tags: ["research"] });

      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7701, workspacePath: "/a" },
        { name: "researcher" as CasaName, state: "running", port: 7702, workspacePath: "/b" },
      ];

      const acl = makeAcl();
      const router = createCasaRouter({ mechaDir, acl, pm: makePm(list) });
      const results = router.routeDiscover("coder" as CasaName, {});

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("researcher");
    });

    it("filters by tag", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "alice", { port: 7701, token: "t", workspace: "/a", tags: ["research"] });
      writeCasaConfig(mechaDir, "bob", { port: 7702, token: "t", workspace: "/b", tags: ["code"] });

      const list: ProcessInfo[] = [
        { name: "alice" as CasaName, state: "running", port: 7701, workspacePath: "/a" },
        { name: "bob" as CasaName, state: "running", port: 7702, workspacePath: "/b" },
      ];

      const acl = makeAcl();
      const router = createCasaRouter({ mechaDir, acl, pm: makePm(list) });
      const results = router.routeDiscover("caller" as CasaName, { tags: ["research"] });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("alice");
    });

    it("filters by capability", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "alice", { port: 7701, token: "t", workspace: "/a", expose: ["query"] });
      writeCasaConfig(mechaDir, "bob", { port: 7702, token: "t", workspace: "/b", expose: ["execute"] });

      const list: ProcessInfo[] = [
        { name: "alice" as CasaName, state: "running", port: 7701, workspacePath: "/a" },
        { name: "bob" as CasaName, state: "running", port: 7702, workspacePath: "/b" },
      ];

      const acl = makeAcl();
      const router = createCasaRouter({ mechaDir, acl, pm: makePm(list) });
      const results = router.routeDiscover("caller" as CasaName, { capability: "query" as Capability });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("alice");
    });

    it("returns empty when no matching CASAs", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const router = createCasaRouter({ mechaDir, acl, pm: makePm([]) });
      const results = router.routeDiscover("coder" as CasaName, {});
      expect(results).toEqual([]);
    });
  });
});
