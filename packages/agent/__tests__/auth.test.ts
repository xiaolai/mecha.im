import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createAuthHook, createSignatureHook, getSource } from "../src/auth.js";
import { createSessionToken, deriveSessionKey } from "../src/session.js";

/** Build a Fastify app with auth hook and test routes */
async function buildAuthApp(opts?: { sessionKey?: string; spaDir?: string }): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook("onRequest", createAuthHook({
    sessionKey: opts?.sessionKey,
    spaDir: opts?.spaDir,
  }));
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/test", async () => ({ ok: true }));
  app.get("/bots", async () => []);
  app.get("/auth/status", async () => ({ methods: {} }));
  app.post("/auth/login", async () => ({ ok: true }));
  app.post("/auth/logout", async () => ({ ok: true }));
  await app.ready();
  return app;
}

/** Build a Fastify app with signature hook */
async function buildSigApp(opts: {
  keys?: Map<string, string>;
  verify?: ReturnType<typeof vi.fn>;
} = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook("preHandler", createSignatureHook({
    nodePublicKeys: opts.keys,
    verifySignature: opts.verify,
  }));
  app.post("/bots/:name/query", async () => ({ ok: true }));
  app.get("/bots", async () => []);
  await app.ready();
  return app;
}

describe("agent auth", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe("createAuthHook", () => {
    it("allows /healthz without auth", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("allows /healthz with query string", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({ method: "GET", url: "/healthz?x=1" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("allows /auth/* paths without auth", async () => {
      const app = await buildAuthApp();
      const res1 = await app.inject({ method: "GET", url: "/auth/status" });
      expect(res1.statusCode).toBe(200);
      const res2 = await app.inject({ method: "POST", url: "/auth/login" });
      expect(res2.statusCode).toBe(200);
      const res3 = await app.inject({ method: "POST", url: "/auth/logout" });
      expect(res3.statusCode).toBe(200);
      await app.close();
    });

    it("rejects requests without session cookie", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = await buildAuthApp({ sessionKey });
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("accepts valid session cookie", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const token = createSessionToken(sessionKey, 1);
      const app = await buildAuthApp({ sessionKey });
      const res = await app.inject({
        method: "GET",
        url: "/bots",
        headers: { cookie: `mecha-session=${token}` },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("rejects invalid session cookie", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = await buildAuthApp({ sessionKey });
      const res = await app.inject({
        method: "GET",
        url: "/bots",
        headers: { cookie: "mecha-session=invalid.token.here" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("skips auth for non-API paths when spaDir is set", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ sessionKey, spaDir: "/fake/spa" }));
      app.get("/bots", async () => []);
      // Catch-all for SPA routes (mimics real server behavior)
      app.setNotFoundHandler(async () => ({ spa: true }));
      await app.ready();

      const res1 = await app.inject({ method: "GET", url: "/some-page" });
      expect(res1.statusCode).toBe(200);
      const res2 = await app.inject({ method: "GET", url: "/bots" });
      expect(res2.statusCode).toBe(401);
      await app.close();
    });

    it("serves SPA for browser navigation to API-prefixed paths without auth", async () => {
      const spaHtml = "<html><body>SPA</body></html>";
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({
        sessionKey, spaDir: "/fake/spa", spaIndexHtml: spaHtml,
      }));
      app.get("/bots", async () => []);
      app.get("/mesh/nodes", async () => []);
      await app.ready();

      // Browser navigation (Accept: text/html) to /mesh → serves SPA HTML
      const res1 = await app.inject({
        method: "GET", url: "/mesh",
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers["content-type"]).toContain("text/html");
      expect(res1.body).toBe(spaHtml);

      // Browser navigation to /bots with text/html → serves SPA, NOT API data
      const res2 = await app.inject({
        method: "GET", url: "/bots",
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toBe(spaHtml);
      expect(res2.body).not.toBe("[]"); // Must NOT leak API data

      // API fetch (no text/html) to /mesh/nodes → still requires auth
      const res3 = await app.inject({
        method: "GET", url: "/mesh/nodes",
        headers: { accept: "application/json" },
      });
      expect(res3.statusCode).toBe(401);

      // API fetch to /bots without auth → 401
      const res4 = await app.inject({ method: "GET", url: "/bots" });
      expect(res4.statusCode).toBe(401);
      await app.close();
    });

    it("requires auth for all paths when spaDir is not set", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({ method: "GET", url: "/some-page" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("accepts valid ticket for /ws/ paths", async () => {
      const { issueTicket } = await import("../src/ws-tickets.js");
      const ticket = issueTicket();
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ sessionKey }));
      app.get("/ws/terminal/alice", async () => ({ ws: true }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: `/ws/terminal/alice?ticket=${ticket}` });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("rejects invalid ticket for /ws/ paths", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ sessionKey }));
      app.get("/ws/terminal/alice", async () => ({ ws: true }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/ws/terminal/alice?ticket=bogus" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("rejects /ws/ paths without ticket", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ sessionKey }));
      app.get("/ws/terminal/alice", async () => ({ ws: true }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/ws/terminal/alice" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("allows /ws/ticket with session cookie auth (not ticket)", async () => {
      const sessionKey = deriveSessionKey("TESTSECRET");
      const token = createSessionToken(sessionKey, 1);
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ sessionKey }));
      app.post("/ws/ticket", async () => ({ ticket: "abc" }));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/ws/ticket",
        headers: { cookie: `mecha-session=${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ticket: "abc" });

      const res2 = await app.inject({ method: "POST", url: "/ws/ticket" });
      expect(res2.statusCode).toBe(401);
      await app.close();
    });

    it("rejects everything when no auth methods configured", async () => {
      const app = await buildAuthApp({ sessionKey: undefined });
      const res = await app.inject({ method: "GET", url: "/bots" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("createSignatureHook", () => {
    it("passes through when no nodePublicKeys configured", async () => {
      const app = await buildSigApp();
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("passes through for non-routing endpoints", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(true);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({ method: "GET", url: "/bots" });
      expect(res.statusCode).toBe(200);
      expect(verify).not.toHaveBeenCalled();
      await app.close();
    });

    it("skips verification for unsigned routing requests (Bearer auth handles these)", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn();
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        payload: { message: "hi" },
      });
      // No x-mecha-signature header → signature hook skips, falls through to route handler
      expect(res.statusCode).toBe(200);
      expect(verify).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects signed request without source header", async () => {
      const keys = new Map([["remote", "pk"]]);
      const app = await buildSigApp({ keys, verify: vi.fn() });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: { "x-mecha-signature": "sig" },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("X-Mecha-Source");
      await app.close();
    });

    it("rejects when source has no node name", async () => {
      const keys = new Map([["remote", "pk"]]);
      const app = await buildSigApp({ keys, verify: vi.fn() });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: { "x-mecha-source": "coder", "x-mecha-signature": "sig" },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("node name");
      await app.close();
    });

    it("rejects unknown node", async () => {
      const keys = new Map([["known", "pk"]]);
      const app = await buildSigApp({ keys, verify: vi.fn() });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: { "x-mecha-source": "coder@unknown", "x-mecha-signature": "sig" },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Unknown node");
      await app.close();
    });

    it("rejects missing timestamp header", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(false);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "badsig",
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Missing X-Mecha-Timestamp");
      await app.close();
    });

    it("rejects expired timestamp", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(false);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "badsig",
          "x-mecha-timestamp": String(Date.now() - 400_000),
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("5-minute window");
      await app.close();
    });

    it("rejects missing nonce header", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(false);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "badsig",
          "x-mecha-timestamp": String(Date.now()),
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Missing X-Mecha-Nonce");
      await app.close();
    });

    it("rejects invalid signature", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(false);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "badsig",
          "x-mecha-timestamp": String(Date.now()),
          "x-mecha-nonce": "nonce-1",
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid signature");
      await app.close();
    });

    it("rejects replayed nonce", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(true);
      const app = await buildSigApp({ keys, verify });
      const res1 = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "validsig",
          "x-mecha-timestamp": String(Date.now()),
          "x-mecha-nonce": "replay-nonce",
        },
        payload: { message: "hi" },
      });
      expect(res1.statusCode).toBe(200);
      const res2 = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "validsig",
          "x-mecha-timestamp": String(Date.now()),
          "x-mecha-nonce": "replay-nonce",
        },
        payload: { message: "hi" },
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json().error).toContain("Nonce already used");
      await app.close();
    });

    it("accepts valid signature", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(true);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "validsig",
          "x-mecha-timestamp": String(Date.now()),
          "x-mecha-nonce": "nonce-valid-1",
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(200);
      expect(verify).toHaveBeenCalledWith("pk", expect.any(Uint8Array), "validsig");
      await app.close();
    });

    it("handles malformed signature gracefully", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockImplementation(() => { throw new Error("bad base64"); });
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "malformed",
          "x-mecha-timestamp": String(Date.now()),
          "x-mecha-nonce": "nonce-malformed-1",
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Malformed signature");
      await app.close();
    });
  });

  describe("getSource", () => {
    it("extracts X-Mecha-Source header", () => {
      const req = { headers: { "x-mecha-source": "coder@alice" } } as any;
      expect(getSource(req)).toBe("coder@alice");
    });

    it("returns undefined when header missing", () => {
      const req = { headers: {} } as any;
      expect(getSource(req)).toBeUndefined();
    });

    it("returns undefined when header is array", () => {
      const req = { headers: { "x-mecha-source": ["a", "b"] } } as any;
      expect(getSource(req)).toBeUndefined();
    });
  });
});
