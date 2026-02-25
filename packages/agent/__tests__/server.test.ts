import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentServer } from "../src/server.js";
import type { AclEngine, CasaName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { makeAcl, writeCasaConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "../../service/__tests__/test-utils.js";

describe("AgentServer", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  function createServer(opts?: { acl?: AclEngine; pm?: ProcessManager }) {
    mechaDir = mkdtempSync(join(tmpdir(), "agent-"));
    return createAgentServer({
      port: 7660,
      apiKey: "test-key",
      processManager: opts?.pm ?? makePm(),
      acl: opts?.acl ?? makeAcl(),
      mechaDir,
      nodeName: "alice",
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
      expect(res.json().error).toBe("Upstream CASA unavailable");
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
