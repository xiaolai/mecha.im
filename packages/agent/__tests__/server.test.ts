import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentServer } from "../src/server.js";
import { deriveSessionKey, createSessionToken } from "../src/session.js";
import type { AclEngine, BotName } from "@mecha/core";
import type { ProcessInfo, ProcessManager } from "@mecha/process";
import { makeAcl, writeBotConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "../../service/__tests__/test-utils.js";

// Mock chat function — SDK spawns external process, not available in unit tests
const mockChatFn = vi.fn();

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const TEST_SESSION_KEY = deriveSessionKey(TEST_TOTP_SECRET);

function authCookie(): string {
  const token = createSessionToken(TEST_SESSION_KEY, 1);
  return `mecha-session=${token}`;
}

describe("AgentServer", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  function createServer(opts?: { acl?: AclEngine; pm?: ProcessManager }) {
    mechaDir = mkdtempSync(join(tmpdir(), "agent-"));
    return createAgentServer({
      port: 7660,
      auth: { totpSecret: TEST_TOTP_SECRET },
      processManager: opts?.pm ?? makePm(),
      acl: opts?.acl ?? makeAcl(),
      mechaDir,
      nodeName: "alice",
      startedAt: "2026-03-02T12:00:00.000Z",
      chatFn: mockChatFn,
    });
  }

  describe("GET /healthz", () => {
    it("returns status ok without auth", async () => {
      const app = createServer();
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.node).toBe("alice");
    });
  });

  describe("auth", () => {
    it("rejects requests without session cookie", async () => {
      const app = createServer();
      const res = await app.inject({ method: "GET", url: "/bots" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects requests with invalid session cookie", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots",
        headers: { cookie: "mecha-session=invalid" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts requests with valid session cookie", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /bots", () => {
    it("returns list of bots", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "GET",
        url: "/bots",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("coder");
    });
  });

  describe("GET /bots/:name/status", () => {
    it("returns bot status", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/status",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("running");
    });

    it("returns 404 for unknown bot", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/ghost/status",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/BAD_NAME/status",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /bots/:name/stop", () => {
    it("stops a running bot", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      const app = createServer({ pm });

      const res = await app.inject({
        method: "POST",
        url: "/bots/coder/stop",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(pm.stop).toHaveBeenCalledWith("coder");
    });

    it("returns 404 for unknown bot", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/ghost/stop",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/BAD_NAME/stop",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 for stopped bot", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "stopped", workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "POST",
        url: "/bots/coder/stop",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("BOT_NOT_RUNNING");
    });
  });

  describe("POST /bots/:name/kill", () => {
    it("kills a bot", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      const app = createServer({ pm });

      const res = await app.inject({
        method: "POST",
        url: "/bots/coder/kill",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(pm.kill).toHaveBeenCalledWith("coder");
    });

    it("returns 404 for unknown bot", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/ghost/kill",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/BAD_NAME/kill",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /bots (spawn)", () => {
    it("spawns a new bot", async () => {
      const pm = makePm();
      (pm.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "analyst",
        state: "running",
        port: 7702,
        workspacePath: "/data",
      });
      const app = createServer({ pm });

      const res = await app.inject({
        method: "POST",
        url: "/bots",
        headers: { cookie: authCookie() },
        payload: { name: "analyst", workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.name).toBe("analyst");
      expect(body.port).toBe(7702);
    });

    it("returns 400 for missing name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots",
        headers: { cookie: authCookie() },
        payload: { workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots",
        headers: { cookie: authCookie() },
        payload: { name: "BAD_NAME", workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for missing workspacePath", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots",
        headers: { cookie: authCookie() },
        payload: { name: "analyst" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 for duplicate bot", async () => {
      const list: ProcessInfo[] = [
        { name: "analyst" as BotName, state: "running", port: 7702, workspacePath: "/data" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "POST",
        url: "/bots",
        headers: { cookie: authCookie() },
        payload: { name: "analyst", workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("GET /bots/:name/sessions", () => {
    it("returns sessions for valid bot", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue({ port: 7700, token: "tok" });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([{ id: "s1", title: "Session 1" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/sessions",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("s1");
    });

    it("returns 404 for unknown bot", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/ghost/sessions",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/BAD_NAME/sessions",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(400);
    });

    it("falls through to empty list when runtime fetch fails", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/sessions",
        headers: { cookie: authCookie() },
      });
      // Runtime fetch fails — falls through to disk fallback (empty)
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("GET /bots/:name/sessions/:id", () => {
    it("returns specific session", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue({ port: 7700, token: "tok" });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "s1", messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/sessions/s1",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("s1");
    });

    it("returns 404 for unknown session", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue({ port: 7700, token: "tok" });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(null), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/sessions/ghost",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for unknown bot", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/ghost/sessions/s1",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/bots/BAD_NAME/sessions/s1",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /bots/:name/schedules (integration)", () => {
    it("returns schedule list for valid bot via createAgentServer", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue({ port: 7700, token: "tok" });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([{ id: "health", trigger: { type: "interval", every: "5m", intervalMs: 300000 }, prompt: "Check health" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/bots/coder/schedules",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0].id).toBe("health");
    });
  });

  describe("POST /bots/:name/query", () => {
    it("forwards query to local bot", async () => {
      const app = createServer();
      writeBotConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });

      mockChatFn.mockResolvedValue({
        response: "Found papers",
        sessionId: "sess-1",
        durationMs: 100,
        costUsd: 0.01,
      });

      const res = await app.inject({
        method: "POST",
        url: "/bots/researcher/query",
        headers: {
          cookie: authCookie(),
          "x-mecha-source": "coder@remote",
        },
        payload: { message: "find papers" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().response).toBe("Found papers");
      expect(mockChatFn).toHaveBeenCalledWith(mechaDir, "researcher", "find papers", undefined);
    });

    it("defaults source to 'admin' when header missing", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/researcher/query",
        headers: { cookie: authCookie() },
        payload: { message: "hello" },
      });
      // No X-Mecha-Source → defaults to "admin", ACL passes (mock allows all),
      // but bot "researcher" not found → 404
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when message missing", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/researcher/query",
        headers: { cookie: authCookie(), "x-mecha-source": "coder" },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/bots/BAD_NAME/query",
        headers: { cookie: authCookie(), "x-mecha-source": "coder" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when ACL denies", async () => {
      const acl = makeAcl({ check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }) });
      const app = createServer({ acl });
      writeBotConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });

      const res = await app.inject({
        method: "POST",
        url: "/bots/researcher/query",
        headers: {
          cookie: authCookie(),
          "x-mecha-source": "coder",
        },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 when bot config not found and skips ACL", async () => {
      const acl = makeAcl({ check: vi.fn() });
      const app = createServer({ acl });
      const res = await app.inject({
        method: "POST",
        url: "/bots/ghost/query",
        headers: { cookie: authCookie(), "x-mecha-source": "coder" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(404);
      expect(acl.check).not.toHaveBeenCalled();
    });

    it("returns 502 when SDK chat fails", async () => {
      const app = createServer();
      writeBotConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });

      mockChatFn.mockRejectedValue(new Error("SDK query failed"));

      const res = await app.inject({
        method: "POST",
        url: "/bots/researcher/query",
        headers: {
          cookie: authCookie(),
          "x-mecha-source": "coder@remote",
        },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toContain("Chat failed:");
    });
  });

  describe("GET /discover", () => {
    it("returns discovered bots", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeBotConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/ws", tags: ["code"], expose: ["query"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover",
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("coder");
      expect(body[0].tags).toEqual(["code"]);
    });

    it("filters by tag", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/a" },
        { name: "researcher" as BotName, state: "running", port: 7701, workspacePath: "/b" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeBotConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/a", tags: ["code"] });
      writeBotConfig(mechaDir, "researcher", { port: 7701, token: "t", workspace: "/b", tags: ["research"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover?tag=research",
        headers: { cookie: authCookie() },
      });
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("researcher");
    });

    it("filters by capability", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as BotName, state: "running", port: 7700, workspacePath: "/a" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeBotConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/a", expose: ["query"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover?capability=execute",
        headers: { cookie: authCookie() },
      });
      expect(res.json()).toHaveLength(0);
    });
  });
});
