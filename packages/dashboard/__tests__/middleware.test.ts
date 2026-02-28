import { describe, it, expect } from "vitest";
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
});
