import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractHost, verifySessionTokenSync, middleware } from "../src/middleware.js";
import { NextRequest } from "next/server.js";
import { deriveSessionKey, createSessionToken } from "../src/lib/session.js";

describe("extractHost", () => {
  it("strips port from IPv4 address", () => {
    expect(extractHost("127.0.0.1:3000")).toBe("127.0.0.1");
  });

  it("returns bare IPv4 without port", () => {
    expect(extractHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("strips port from hostname", () => {
    expect(extractHost("localhost:3457")).toBe("localhost");
  });

  it("returns bare hostname without port", () => {
    expect(extractHost("localhost")).toBe("localhost");
  });

  it("extracts IPv6 from bracketed notation with port", () => {
    expect(extractHost("[::1]:3000")).toBe("::1");
  });

  it("extracts IPv6 from bracketed notation without port", () => {
    expect(extractHost("[::1]")).toBe("::1");
  });

  it("returns raw string for malformed bracket (no closing)", () => {
    expect(extractHost("[::1")).toBe("[::1");
  });

  it("returns empty string for empty input", () => {
    expect(extractHost("")).toBe("");
  });

  it("does not strip non-port suffix after colon", () => {
    expect(extractHost("host:abc")).toBe("host:abc");
  });
});

describe("verifySessionTokenSync", () => {
  const secret = "TESTSECRETVALUE";
  const key = deriveSessionKey(secret);

  it("accepts a valid token", () => {
    const token = createSessionToken(key, 24);
    expect(verifySessionTokenSync(key, token)).toBe(true);
  });

  it("rejects a token with wrong key", () => {
    const token = createSessionToken(key, 24);
    const wrongKey = deriveSessionKey("WRONGSECRET");
    expect(verifySessionTokenSync(wrongKey, token)).toBe(false);
  });

  it("rejects an expired token", () => {
    // Create token that expired 1 hour ago
    const token = createSessionToken(key, -1);
    expect(verifySessionTokenSync(key, token)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifySessionTokenSync(key, "not.a.jwt")).toBe(false);
    expect(verifySessionTokenSync(key, "only-one-part")).toBe(false);
    expect(verifySessionTokenSync(key, "")).toBe(false);
  });

  it("rejects token with tampered payload", () => {
    const token = createSessionToken(key, 24);
    const parts = token.split(".");
    // Tamper with the payload
    const tamperedPayload = Buffer.from(JSON.stringify({ iat: 0, exp: 9999999999 })).toString("base64url");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(verifySessionTokenSync(key, tampered)).toBe(false);
  });
});

function makeRequest(url: string, opts?: { method?: string; headers?: Record<string, string> }): NextRequest {
  const headers = new Headers(opts?.headers ?? {});
  if (!headers.has("host")) headers.set("host", "localhost:3457");
  return new NextRequest(url, { method: opts?.method ?? "GET", headers });
}

describe("middleware", () => {
  const origNetworkMode = process.env.MECHA_NETWORK_MODE;
  const origOtp = process.env.MECHA_OTP;
  const origSessionKey = process.env.MECHA_SESSION_KEY;

  beforeEach(() => {
    delete process.env.MECHA_NETWORK_MODE;
    delete process.env.MECHA_OTP;
    delete process.env.MECHA_SESSION_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (origNetworkMode !== undefined) process.env.MECHA_NETWORK_MODE = origNetworkMode;
    else delete process.env.MECHA_NETWORK_MODE;
    if (origOtp !== undefined) process.env.MECHA_OTP = origOtp;
    else delete process.env.MECHA_OTP;
    if (origSessionKey !== undefined) process.env.MECHA_SESSION_KEY = origSessionKey;
    else delete process.env.MECHA_SESSION_KEY;
    vi.restoreAllMocks();
  });

  // --- DNS rebinding (localhost mode) ---
  it("allows localhost GET request", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas"));
    expect(res.status).not.toBe(403);
  });

  it("allows 127.0.0.1 GET request", () => {
    const res = middleware(makeRequest("http://127.0.0.1:3457/api/casas", {
      headers: { host: "127.0.0.1:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  it("allows [::1] GET request", () => {
    const res = middleware(makeRequest("http://[::1]:3457/api/casas", {
      headers: { host: "[::1]:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  it("blocks non-localhost host and logs rejection", () => {
    const res = middleware(makeRequest("http://evil.com/api/casas", {
      headers: { host: "evil.com" },
    }));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(console.warn).toHaveBeenCalled();
  });

  // --- CSRF ---
  it("allows safe methods without origin check", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas", {
      method: "GET",
    }));
    expect(res.status).not.toBe(403);
  });

  it("allows POST with same-origin origin header", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "localhost:3457", origin: "http://localhost:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  it("blocks POST with cross-origin origin header", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "localhost:3457", origin: "http://evil.com" },
    }));
    expect(res.status).toBe(403);
  });

  it("blocks POST with invalid origin URL", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "localhost:3457", origin: "not-a-url" },
    }));
    expect(res.status).toBe(403);
  });

  it("blocks POST without origin header (CSRF protection)", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "localhost:3457" },
    }));
    expect(res.status).toBe(403);
    expect(console.warn).toHaveBeenCalled();
  });

  it("allows DELETE with localhost origin", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice", {
      method: "DELETE",
      headers: { host: "localhost:3457", origin: "http://localhost:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  // --- Network mode ---
  it("allows non-localhost host in network mode", () => {
    process.env.MECHA_NETWORK_MODE = "true";
    const res = middleware(makeRequest("http://myhost.local:3457/api/casas", {
      headers: { host: "myhost.local:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  it("allows POST with matching host origin in network mode", () => {
    process.env.MECHA_NETWORK_MODE = "true";
    const res = middleware(makeRequest("http://myhost.local:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "myhost.local:3457", origin: "http://myhost.local:3457" },
    }));
    expect(res.status).not.toBe(403);
  });

  it("blocks cross-origin POST in network mode", () => {
    process.env.MECHA_NETWORK_MODE = "true";
    const res = middleware(makeRequest("http://myhost.local:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "myhost.local:3457", origin: "http://evil.com" },
    }));
    expect(res.status).toBe(403);
  });

  // --- Session auth ---
  it("requires session cookie when TOTP configured", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    const res = middleware(makeRequest("http://localhost:3457/api/casas"));
    expect(res.status).toBe(401);
  });

  it("redirects page routes to login when session missing", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    const res = middleware(makeRequest("http://localhost:3457/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows public paths without session", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    const loginRes = middleware(makeRequest("http://localhost:3457/login"));
    expect(loginRes.status).not.toBe(401);
    expect(loginRes.status).not.toBe(307);

    const authRes = middleware(makeRequest("http://localhost:3457/api/auth/login", {
      method: "POST",
      headers: { host: "localhost:3457", origin: "http://localhost:3457" },
    }));
    expect(authRes.status).not.toBe(401);
  });

  it("allows requests with valid session token when TOTP configured", () => {
    const secret = "TESTSECRET";
    process.env.MECHA_OTP = secret;
    const key = deriveSessionKey(secret);
    process.env.MECHA_SESSION_KEY = key;
    const token = createSessionToken(key, 24);

    const req = new NextRequest("http://localhost:3457/api/casas", {
      headers: { host: "localhost:3457", cookie: `mecha-session=${token}` },
    });
    const res = middleware(req);
    expect(res.status).not.toBe(401);
  });

  it("rejects requests with invalid session token", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    process.env.MECHA_SESSION_KEY = deriveSessionKey("TESTSECRET");

    const req = new NextRequest("http://localhost:3457/api/casas", {
      headers: { host: "localhost:3457", cookie: "mecha-session=garbage-token" },
    });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with expired session token", () => {
    const secret = "TESTSECRET";
    process.env.MECHA_OTP = secret;
    const key = deriveSessionKey(secret);
    process.env.MECHA_SESSION_KEY = key;
    const expiredToken = createSessionToken(key, -1);

    const req = new NextRequest("http://localhost:3457/api/casas", {
      headers: { host: "localhost:3457", cookie: `mecha-session=${expiredToken}` },
    });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("redirects page route to login for invalid session token", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    process.env.MECHA_SESSION_KEY = deriveSessionKey("TESTSECRET");

    const req = new NextRequest("http://localhost:3457/", {
      headers: { host: "localhost:3457", cookie: "mecha-session=garbage" },
    });
    const res = middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("rejects when session key not pre-computed", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    // MECHA_SESSION_KEY not set — verification should fail
    const key = deriveSessionKey("TESTSECRET");
    const token = createSessionToken(key, 24);

    const req = new NextRequest("http://localhost:3457/api/casas", {
      headers: { host: "localhost:3457", cookie: `mecha-session=${token}` },
    });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("skips session check when TOTP not configured (v1 compat)", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas"));
    expect(res.status).not.toBe(401);
  });

  it("allows _next paths without session", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    const res = middleware(makeRequest("http://localhost:3457/_next/static/chunk.js"));
    expect(res.status).not.toBe(401);
  });
});
