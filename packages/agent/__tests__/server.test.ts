import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AclEngine, Capability } from "@mecha/core";
import { createAgentServer } from "../src/server.js";
import { deriveSessionKey, createSessionToken } from "../src/session.js";

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function makeAuthCookie(secret = TEST_TOTP_SECRET): string {
  const sessionKey = deriveSessionKey(secret);
  const token = createSessionToken(sessionKey, 1);
  return `mecha-session=${token}`;
}

function makeAcl(overrides: Partial<AclEngine> = {}): AclEngine {
  return {
    grant: vi.fn(),
    revoke: vi.fn(),
    check: vi.fn().mockReturnValue({ allowed: true }),
    listRules: vi.fn().mockReturnValue([]),
    listConnections: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    ...overrides,
  } as unknown as AclEngine;
}

function makePm() {
  return {
    spawn: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  };
}

// Mock forwardQueryToBot so we don't need real bot processes
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    forwardQueryToBot: vi.fn().mockResolvedValue({
      text: "bot says hello",
      sessionId: "sess-1",
    }),
  };
});

describe("createAgentServer", () => {
  let mechaDir: string;
  let server: ReturnType<typeof createAgentServer>;
  let port: number;

  beforeAll(async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "agent-test-"));
    // Write a bot config
    const botDir = join(mechaDir, "analyst");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 9999, token: "test-token", workspace: "/tmp",
    }));

    server = createAgentServer({
      port: 0,
      auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "test-key" },
      processManager: makePm() as never,
      acl: makeAcl(),
      mechaDir,
      nodeName: "test-node",
    });
    const addr = await server.listen({ port: 0, host: "127.0.0.1" });
    port = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await server.close();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("GET /healthz returns ok without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });

  it("POST /bots/:name/query returns 401 without any auth", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /bots/:name/query returns 401 with invalid session cookie", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "mecha-session=invalid",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /bots/:name/query accepts Bearer token auth", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /bots/:name/query rejects invalid Bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-key",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /bots/:name/query returns 200 with valid cookie and source", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { response: string; sessionId: string };
    expect(body.response).toBe("bot says hello");
    expect(body.sessionId).toBe("sess-1");
  });

  it("returns 400 for invalid bot name", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/.invalid/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing message", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty message", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
      },
      body: JSON.stringify({ message: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent bot", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/nonexistent/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when ACL denies", async () => {
    const denyAcl = makeAcl({ check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }) });
    const denyServer = createAgentServer({
      port: 0,
      auth: { totpSecret: TEST_TOTP_SECRET },
      processManager: makePm() as never,
      acl: denyAcl,
      mechaDir,
      nodeName: "test-node",
    });
    const addr = await denyServer.listen({ port: 0, host: "127.0.0.1" });
    const denyPort = parseInt(new URL(addr).port, 10);

    try {
      const res = await fetch(`http://127.0.0.1:${denyPort}/bots/analyst/query`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: makeAuthCookie(),
          "x-mecha-source": "coder@alice",
        },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await denyServer.close();
    }
  });

  it("defaults source to 'admin' when X-Mecha-Source is missing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
      },
      body: JSON.stringify({ message: "hello" }),
    });
    // With open ACL, admin should be allowed
    expect(res.status).toBe(200);
  });

  it("listen returns a URL string with port", async () => {
    const s = createAgentServer({
      port: 0,
      auth: {},
      processManager: makePm() as never,
      acl: makeAcl(),
      mechaDir,
      nodeName: "url-test",
    });
    const addr = await s.listen({ port: 0, host: "127.0.0.1" });
    expect(addr).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const p = parseInt(new URL(addr).port, 10);
    expect(p).toBeGreaterThan(0);
    await s.close();
  });
});
