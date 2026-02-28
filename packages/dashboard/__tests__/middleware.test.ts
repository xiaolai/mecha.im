import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractHost, middleware } from "../src/middleware.js";
import { NextRequest } from "next/server.js";

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

function makeRequest(url: string, opts?: { method?: string; headers?: Record<string, string> }): NextRequest {
  const headers = new Headers(opts?.headers ?? {});
  if (!headers.has("host")) headers.set("host", "localhost:3457");
  return new NextRequest(url, { method: opts?.method ?? "GET", headers });
}

describe("middleware", () => {
  const origNetworkMode = process.env.MECHA_NETWORK_MODE;
  const origOtp = process.env.MECHA_OTP;

  beforeEach(() => {
    delete process.env.MECHA_NETWORK_MODE;
    delete process.env.MECHA_OTP;
  });

  afterEach(() => {
    if (origNetworkMode !== undefined) process.env.MECHA_NETWORK_MODE = origNetworkMode;
    else delete process.env.MECHA_NETWORK_MODE;
    if (origOtp !== undefined) process.env.MECHA_OTP = origOtp;
    else delete process.env.MECHA_OTP;
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

  it("blocks non-localhost host", () => {
    const res = middleware(makeRequest("http://evil.com/api/casas", {
      headers: { host: "evil.com" },
    }));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
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

  it("allows POST without origin header (same-site navigation)", () => {
    const res = middleware(makeRequest("http://localhost:3457/api/casas/alice/stop", {
      method: "POST",
      headers: { host: "localhost:3457" },
    }));
    expect(res.status).not.toBe(403);
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
      headers: { host: "localhost:3457" },
    }));
    expect(authRes.status).not.toBe(401);
  });

  it("allows requests with session cookie when TOTP configured", () => {
    process.env.MECHA_OTP = "TESTSECRET";
    const req = new NextRequest("http://localhost:3457/api/casas", {
      headers: { host: "localhost:3457", cookie: "mecha-session=some-token" },
    });
    const res = middleware(req);
    expect(res.status).not.toBe(401);
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
