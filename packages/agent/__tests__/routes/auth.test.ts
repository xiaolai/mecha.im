import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { TOTP, Secret } from "otpauth";
import { registerAuthRoutes } from "../../src/routes/auth.js";
import { deriveSessionKey } from "../../src/session.js";

const TEST_SECRET = new Secret({ size: 20 }).base32;
const TEST_SESSION_KEY = deriveSessionKey(TEST_SECRET);

function generateCode(secret: string): string {
  return new TOTP({
    issuer: "mecha",
    label: "agent",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function buildApp(opts?: {
  totpSecret?: string | null;
  sessionKey?: string | null;
}): Promise<FastifyInstance> {
  const app = Fastify();
  registerAuthRoutes(app, {
    totpSecret: opts?.totpSecret === null ? undefined : (opts?.totpSecret ?? TEST_SECRET),
    sessionKey: opts?.sessionKey === null ? undefined : (opts?.sessionKey ?? TEST_SESSION_KEY),
  });
  await app.ready();
  return app;
}

describe("auth routes", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe("GET /auth/status", () => {
    it("returns available methods", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        methods: { totp: true },
      });
      await app.close();
    });

    it("shows totp false when not configured", async () => {
      const app = await buildApp({ totpSecret: null });
      const res = await app.inject({ method: "GET", url: "/auth/status" });
      expect(res.json().methods).toEqual({ totp: false });
      await app.close();
    });
  });

  describe("POST /auth/login", () => {
    it("returns 404 when TOTP not configured", async () => {
      const app = await buildApp({ totpSecret: null, sessionKey: null });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { code: "123456" },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("returns 400 for missing code", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("returns 401 for invalid code", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { code: "000000" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid TOTP");
      await app.close();
    });

    it("sets session cookie for valid code", async () => {
      const app = await buildApp();
      const code = generateCode(TEST_SECRET);
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { code },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      const setCookie = res.headers["set-cookie"] as string;
      expect(setCookie).toContain("mecha-session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      await app.close();
    });

    it("sets Secure cookie flag when x-forwarded-proto is https", async () => {
      const app = await buildApp();
      const code = generateCode(TEST_SECRET);
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-forwarded-proto": "https" },
        payload: { code },
      });
      expect(res.statusCode).toBe(200);
      const setCookie = res.headers["set-cookie"] as string;
      expect(setCookie).toContain("; Secure");
      await app.close();
    });

    it("rate limits after too many failures", async () => {
      const app = await buildApp();
      // 5 failures to trigger lockout
      for (let i = 0; i < 5; i++) {
        await app.inject({ method: "POST", url: "/auth/login", payload: { code: "000000" } });
      }
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { code: "000000" },
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toContain("Too many attempts");
      await app.close();
    });
  });

  describe("POST /auth/logout", () => {
    it("clears session cookie", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/auth/logout" });
      expect(res.statusCode).toBe(200);
      const setCookie = res.headers["set-cookie"] as string;
      expect(setCookie).toContain("Max-Age=0");
      await app.close();
    });
  });
});
