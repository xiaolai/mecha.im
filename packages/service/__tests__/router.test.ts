import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCasaRouter } from "../src/router.js";
import type { CasaName, Capability, NodeEntry } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import type { MechaLocator, LocateResult } from "../src/locator.js";
import { makeAcl, writeCasaConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "./test-utils.js";

describe("createCasaRouter", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

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

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "I found 3 papers" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "find papers");

      expect(result).toEqual({ text: "I found 3 papers", sessionId: undefined });
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:7700/api/chat",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer tok123",
          }),
        }),
      );
    });

    it("throws when target returns non-OK", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("error", { status: 500 }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      await expect(
        router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello"),
      ).rejects.toThrow(/returned HTTP 500/);
    });

    it("returns JSON stringified when response.response is not a string", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [1, 2, 3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello");
      expect(result.text).toContain('"data"');
    });

    it("returns text when response is not JSON", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("plain text response", { status: 200, headers: { "content-type": "text/plain" } }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery("coder" as CasaName, "researcher" as CasaName, "hello");
      expect(result.text).toBe("plain text response");
    });

    it("passes sessionId through to forwardQueryToCasa", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "continued", sessionId: "sess-xyz" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm() });
      const result = await router.routeQuery(
        "coder" as CasaName, "researcher" as CasaName, "continue", "sess-xyz",
      );
      expect(result).toEqual({ text: "continued", sessionId: "sess-xyz" });

      const call = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);
      expect(body.sessionId).toBe("sess-xyz");
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

  describe("remote routing (with locator)", () => {
    const bobNode: NodeEntry = {
      name: "bob", host: "192.168.1.10", port: 7660,
      apiKey: "key", addedAt: "2026-01-01T00:00:00Z",
    };

    function makeLocator(result: LocateResult): MechaLocator {
      return { locate: vi.fn().mockReturnValue(result) };
    }

    it("routes locally when locator returns local", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws" });
      const acl = makeAcl();
      const locator = makeLocator({ location: "local", port: 7700, token: "tok" });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "local result" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator });
      const result = await router.routeQuery("coder", "researcher", "hello");
      expect(result.text).toBe("local result");
    });

    it("routes remotely when locator returns remote", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "remote result" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({
        mechaDir, acl, pm: makePm(), locator,
        agentFetch: mockFetch,
        sourceName: "alice",
      });
      const result = await router.routeQuery("coder", "analyst@bob", "hello");

      expect(result.text).toBe("remote result");
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
        node: bobNode,
        path: "/casas/analyst/query",
        method: "POST",
        source: "coder@alice",
      }));
    });

    it("returns JSON stringified for non-string remote response", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [1, 2, 3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator, agentFetch: mockFetch });
      const result = await router.routeQuery("coder", "analyst@bob", "hello");
      expect(result.text).toContain('"data"');
    });

    it("returns sessionId from remote response", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "ok", sessionId: "sess-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator, agentFetch: mockFetch });
      const result = await router.routeQuery("coder", "analyst@bob", "hello");
      expect(result.sessionId).toBe("sess-1");
    });

    it("throws when remote node returns non-OK", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("error", { status: 500 }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator, agentFetch: mockFetch });
      await expect(
        router.routeQuery("coder", "analyst@bob", "hello"),
      ).rejects.toThrow(/HTTP 500/);
    });

    it("throws CasaNotFoundError when locator returns not_found", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "not_found" });

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator });
      await expect(
        router.routeQuery("coder", "ghost@unknown", "hello"),
      ).rejects.toThrow(/not found/i);
    });

    it("throws when remote but agentFetch not provided", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator });
      await expect(
        router.routeQuery("coder", "analyst@bob", "hello"),
      ).rejects.toThrow(/Remote node/);
    });

    it("returns text when remote response is not JSON", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator, agentFetch: mockFetch });
      const result = await router.routeQuery("coder", "analyst@bob", "hello");
      expect(result.text).toBe("plain text");
    });

    it("does not double-qualify source that already has @", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({
        mechaDir, acl, pm: makePm(), locator,
        agentFetch: mockFetch, sourceName: "alice",
      });
      await router.routeQuery("coder@alice", "analyst@bob", "hello");

      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
        source: "coder@alice",
      }));
    });

    it("uses source name without @node when sourceName not set", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "router-"));
      const acl = makeAcl();
      const locator = makeLocator({ location: "remote", node: bobNode });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const router = createCasaRouter({ mechaDir, acl, pm: makePm(), locator, agentFetch: mockFetch });
      await router.routeQuery("coder", "analyst@bob", "hello");

      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
        source: "coder",
      }));
    });
  });
});
