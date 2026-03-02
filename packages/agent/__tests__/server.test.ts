import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentServer } from "../src/server.js";
import type { AclEngine, CasaName } from "@mecha/core";
import type { ProcessInfo, ProcessManager } from "@mecha/process";
import { makeAcl, writeCasaConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "../../service/__tests__/test-utils.js";

describe("AgentServer", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  function createServer(opts?: { acl?: AclEngine; pm?: ProcessManager }) {
    mechaDir = mkdtempSync(join(tmpdir(), "agent-"));
    return createAgentServer({
      port: 7660,
      auth: { apiKey: "test-key" },
      processManager: opts?.pm ?? makePm(),
      acl: opts?.acl ?? makeAcl(),
      mechaDir,
      nodeName: "alice",
      startedAt: "2026-03-02T12:00:00.000Z",
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
    it("rejects requests without auth header", async () => {
      const app = createServer();
      const res = await app.inject({ method: "GET", url: "/casas" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects requests with wrong key", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas",
        headers: { authorization: "Bearer wrong" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts requests with correct key", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /casas", () => {
    it("returns list of CASAs", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "GET",
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("coder");
    });
  });

  describe("GET /casas/:name/status", () => {
    it("returns CASA status", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "GET",
        url: "/casas/coder/status",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("running");
    });

    it("returns 404 for unknown CASA", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/ghost/status",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/BAD_NAME/status",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /casas/:name/stop", () => {
    it("stops a running CASA", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      const app = createServer({ pm });

      const res = await app.inject({
        method: "POST",
        url: "/casas/coder/stop",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(pm.stop).toHaveBeenCalledWith("coder");
    });

    it("returns 404 for unknown CASA", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/ghost/stop",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/BAD_NAME/stop",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 for stopped CASA", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "stopped", workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "POST",
        url: "/casas/coder/stop",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("CASA_NOT_RUNNING");
    });
  });

  describe("POST /casas/:name/kill", () => {
    it("kills a CASA", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      const app = createServer({ pm });

      const res = await app.inject({
        method: "POST",
        url: "/casas/coder/kill",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(pm.kill).toHaveBeenCalledWith("coder");
    });

    it("returns 404 for unknown CASA", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/ghost/kill",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/BAD_NAME/kill",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /casas (spawn)", () => {
    it("spawns a new CASA", async () => {
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
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
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
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
        payload: { workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
        payload: { name: "BAD_NAME", workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for missing workspacePath", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
        payload: { name: "analyst" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 for duplicate CASA", async () => {
      const list: ProcessInfo[] = [
        { name: "analyst" as CasaName, state: "running", port: 7702, workspacePath: "/data" },
      ];
      const app = createServer({ pm: makePm(list) });

      const res = await app.inject({
        method: "POST",
        url: "/casas",
        headers: { authorization: "Bearer test-key" },
        payload: { name: "analyst", workspacePath: "/data" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("GET /casas/:name/sessions", () => {
    it("returns sessions for valid CASA", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
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
        url: "/casas/coder/sessions",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("s1");
    });

    it("returns 404 for unknown CASA", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/ghost/sessions",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/BAD_NAME/sessions",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 502 when session fetch fails", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const pm = makePm(list);
      (pm.getPortAndToken as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const app = createServer({ pm });
      const res = await app.inject({
        method: "GET",
        url: "/casas/coder/sessions",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(502);
    });
  });

  describe("GET /casas/:name/sessions/:id", () => {
    it("returns specific session", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
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
        url: "/casas/coder/sessions/s1",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("s1");
    });

    it("returns 404 for unknown session", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
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
        url: "/casas/coder/sessions/ghost",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for unknown CASA", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/ghost/sessions/s1",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "GET",
        url: "/casas/BAD_NAME/sessions/s1",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /casas/:name/query", () => {
    it("forwards query to local CASA", async () => {
      const app = createServer();
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "Found papers" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await app.inject({
        method: "POST",
        url: "/casas/researcher/query",
        headers: {
          authorization: "Bearer test-key",
          "x-mecha-source": "coder@remote",
        },
        payload: { message: "find papers" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().response).toBe("Found papers");
    });

    it("returns 400 when source header missing", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/researcher/query",
        headers: { authorization: "Bearer test-key" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("X-Mecha-Source");
    });

    it("returns 400 when message missing", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/researcher/query",
        headers: { authorization: "Bearer test-key", "x-mecha-source": "coder" },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid CASA name", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/BAD_NAME/query",
        headers: { authorization: "Bearer test-key", "x-mecha-source": "coder" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when ACL denies", async () => {
      const acl = makeAcl({ check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }) });
      const app = createServer({ acl });

      const res = await app.inject({
        method: "POST",
        url: "/casas/researcher/query",
        headers: {
          authorization: "Bearer test-key",
          "x-mecha-source": "coder",
        },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 when CASA config not found", async () => {
      const app = createServer();
      const res = await app.inject({
        method: "POST",
        url: "/casas/ghost/query",
        headers: { authorization: "Bearer test-key", "x-mecha-source": "coder" },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 502 when upstream CASA fails", async () => {
      const app = createServer();
      writeCasaConfig(mechaDir, "researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });

      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      const res = await app.inject({
        method: "POST",
        url: "/casas/researcher/query",
        headers: {
          authorization: "Bearer test-key",
          "x-mecha-source": "coder@remote",
        },
        payload: { message: "hello" },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toContain("Upstream CASA unavailable");
    });
  });

  describe("GET /discover", () => {
    it("returns discovered CASAs", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeCasaConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/ws", tags: ["code"], expose: ["query"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("coder");
      expect(body[0].tags).toEqual(["code"]);
    });

    it("filters by tag", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/a" },
        { name: "researcher" as CasaName, state: "running", port: 7701, workspacePath: "/b" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeCasaConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/a", tags: ["code"] });
      writeCasaConfig(mechaDir, "researcher", { port: 7701, token: "t", workspace: "/b", tags: ["research"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover?tag=research",
        headers: { authorization: "Bearer test-key" },
      });
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("researcher");
    });

    it("filters by capability", async () => {
      const list: ProcessInfo[] = [
        { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/a" },
      ];
      const app = createServer({ pm: makePm(list) });
      writeCasaConfig(mechaDir, "coder", { port: 7700, token: "t", workspace: "/a", expose: ["query"] });

      const res = await app.inject({
        method: "GET",
        url: "/discover?capability=execute",
        headers: { authorization: "Bearer test-key" },
      });
      expect(res.json()).toHaveLength(0);
    });
  });
});
