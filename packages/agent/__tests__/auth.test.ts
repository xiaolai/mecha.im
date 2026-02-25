import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createAuthHook, createSignatureHook, getSource } from "../src/auth.js";

/** Build a Fastify app with auth hook and test routes */
async function buildAuthApp(apiKey = "secret"): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook("onRequest", createAuthHook({ apiKey }));
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/test", async () => ({ ok: true }));
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
    apiKey: "k",
    nodePublicKeys: opts.keys,
    verifySignature: opts.verify,
  }));
  app.post("/casas/:name/query", async () => ({ ok: true }));
  app.get("/casas", async () => []);
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

    it("rejects missing auth header", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("rejects wrong bearer token", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({
        method: "GET",
        url: "/test",
        headers: { authorization: "Bearer wrong" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("rejects non-Bearer scheme", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({
        method: "GET",
        url: "/test",
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("accepts correct bearer token", async () => {
      const app = await buildAuthApp();
      const res = await app.inject({
        method: "GET",
        url: "/test",
        headers: { authorization: "Bearer secret" },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("createSignatureHook", () => {
    it("passes through when no nodePublicKeys configured", async () => {
      const app = await buildSigApp();
      const res = await app.inject({
        method: "POST",
        url: "/casas/alice/query",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("passes through for non-routing endpoints", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(true);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({ method: "GET", url: "/casas" });
      expect(res.statusCode).toBe(200);
      expect(verify).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects routing requests without source header", async () => {
      const keys = new Map([["remote", "pk"]]);
      const app = await buildSigApp({ keys, verify: vi.fn() });
      const res = await app.inject({
        method: "POST",
        url: "/casas/alice/query",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("signature");
      await app.close();
    });

    it("rejects when source has no node name", async () => {
      const keys = new Map([["remote", "pk"]]);
      const app = await buildSigApp({ keys, verify: vi.fn() });
      const res = await app.inject({
        method: "POST",
        url: "/casas/alice/query",
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
        url: "/casas/alice/query",
        headers: { "x-mecha-source": "coder@unknown", "x-mecha-signature": "sig" },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Unknown node");
      await app.close();
    });

    it("rejects invalid signature", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(false);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/casas/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "badsig",
        },
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid signature");
      await app.close();
    });

    it("accepts valid signature", async () => {
      const keys = new Map([["remote", "pk"]]);
      const verify = vi.fn().mockReturnValue(true);
      const app = await buildSigApp({ keys, verify });
      const res = await app.inject({
        method: "POST",
        url: "/casas/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "validsig",
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
        url: "/casas/alice/query",
        headers: {
          "x-mecha-source": "coder@remote",
          "x-mecha-signature": "malformed",
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
