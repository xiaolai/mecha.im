import { describe, it, expect, afterEach } from "vitest";
import { generateToken, createAuthMiddleware } from "../src/auth/token.js";
import { generateTotp, verifyTotp } from "@mecha/core";
import { createServer } from "../src/server.js";
import type { MechaId } from "@mecha/core";

const TEST_ID = "mx-test-abc123" as MechaId;

describe("Auth token", () => {
  it("generates a 64-character hex token", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens each time", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe("Auth middleware", () => {
  let app: ReturnType<typeof createServer>;
  const token = generateToken();

  afterEach(async () => {
    if (app) await app.close();
  });

  function makeApp() {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: token });
    return app;
  }

  it("allows requests with valid Bearer token", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects requests without token", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/info",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with invalid token", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("bypasses auth for /healthz", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("TOTP", () => {
  const secret = "JBSWY3DPEHPK3PXP"; // well-known test secret

  it("generates a 6-digit code", () => {
    const code = generateTotp(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("verifies a valid code", () => {
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects an invalid code", () => {
    expect(verifyTotp(secret, "000000")).toBe(false);
  });

  it("rejects non-6-digit input", () => {
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
  });
});

describe("OTP auth", () => {
  let app: ReturnType<typeof createServer>;
  const token = generateToken();
  const otpSecret = "JBSWY3DPEHPK3PXP";

  afterEach(async () => {
    if (app) await app.close();
  });

  function makeApp(opts?: { otp?: string }) {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: token, otp: opts?.otp ?? otpSecret });
    return app;
  }

  it("rejects OTP via query parameter (header only)", async () => {
    makeApp();
    const code = generateTotp(otpSecret);
    const res = await app.inject({
      method: "GET",
      url: `/info?otp=${code}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows access via X-Mecha-OTP header with valid TOTP code", async () => {
    makeApp();
    const code = generateTotp(otpSecret);
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { "x-mecha-otp": code },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects wrong TOTP code via header", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { "x-mecha-otp": "000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("still accepts Bearer token when OTP is configured", async () => {
    makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("does not accept TOTP code when no OTP secret is configured", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: token });
    const code = generateTotp(otpSecret);
    const res = await app.inject({
      method: "GET",
      url: `/info?otp=${code}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
