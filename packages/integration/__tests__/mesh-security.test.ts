/**
 * Integration tests for agent server authentication and signature verification.
 *
 * Tests raw HTTP calls to agent server endpoints:
 * - Bearer token authentication
 * - Ed25519 request signatures
 * - Timestamp window enforcement
 * - Nonce replay protection
 */

import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import type { Capability, NodeEntry } from "@mecha/core";
import { createAclEngine, writeNodes, signMessage } from "@mecha/core";
import { createAgentServer } from "@mecha/agent";
import { deriveSessionKey, createSessionToken } from "../../agent/src/session.js";
import { makePm, writeBotConfig } from "./helpers/mesh-harness.js";

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function makeAuthCookie(secret = TEST_TOTP_SECRET): string {
  const sessionKey = deriveSessionKey(secret);
  const token = createSessionToken(sessionKey, 1);
  return `mecha-session=${token}`;
}

// Mock chat function — no real Claude processes
const mockChatFn = vi.fn().mockResolvedValue({
  response: "secure response",
  sessionId: "sec-sess",
  durationMs: 100,
  costUsd: 0.01,
});

describe("mesh security: authentication", () => {
  let bobDir: string;
  let bobServer: ReturnType<typeof createAgentServer>;
  let bobPort: number;

  beforeAll(async () => {
    bobDir = mkdtempSync(join(tmpdir(), "sec-bob-"));
    writeBotConfig(bobDir, "analyst", {
      port: 9999, token: "tok", workspace: "/tmp",
    });

    const acl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder@alice", "analyst", ["query"] as Capability[]);

    bobServer = createAgentServer({
      port: 0, auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "mesh-routing-key" }, processManager: makePm(),
      acl, mechaDir: bobDir, nodeName: "bob", chatFn: mockChatFn,
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
  });

  it("returns 401 when session cookie is missing", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie is invalid", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "mecha-session=invalid",
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when X-Mecha-Source header is missing (defaults to 'admin', ACL denied)", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with valid session cookie and source header", async () => {
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: makeAuthCookie(),
        "x-mecha-source": "coder@alice",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("mesh security: Ed25519 signatures", () => {
  let bobDir: string;
  let bobServer: ReturnType<typeof createAgentServer>;
  let bobPort: number;
  let aliceKeyPair: ReturnType<typeof generateKeyPairSync>;
  let alicePubB64: string;
  let alicePubPem: string;

  beforeAll(async () => {
    // Generate alice's Ed25519 key pair
    aliceKeyPair = generateKeyPairSync("ed25519");
    const pubDer = aliceKeyPair.publicKey.export({ type: "spki", format: "der" });
    alicePubB64 = pubDer.toString("base64");
    alicePubPem = aliceKeyPair.publicKey.export({ type: "spki", format: "pem" }) as string;

    bobDir = mkdtempSync(join(tmpdir(), "sig-bob-"));
    writeBotConfig(bobDir, "analyst", {
      port: 9999, token: "tok", workspace: "/tmp",
    });

    // Write alice's public key to bob's nodes.json for signature verification
    writeNodes(bobDir, [{
      name: "alice" as NodeEntry["name"],
      host: "127.0.0.1",
      port: 9998,
      apiKey: "alice-key",
      publicKey: alicePubPem,
      fingerprint: "fp-alice",
      addedAt: new Date().toISOString(),
    }]);

    const acl = createAclEngine({
      mechaDir: bobDir,
      getExpose: () => ["query"] as Capability[],
    });
    acl.grant("coder@alice", "analyst", ["query"] as Capability[]);

    bobServer = createAgentServer({
      port: 0, auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "mesh-routing-key" }, processManager: makePm(),
      acl, mechaDir: bobDir, nodeName: "bob", chatFn: mockChatFn,
    });
    const addr = await bobServer.listen({ port: 0, host: "127.0.0.1" });
    bobPort = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await bobServer.close();
    rmSync(bobDir, { recursive: true, force: true });
  });

  function makeSignedHeaders(
    body: Record<string, unknown>,
    opts?: { timestamp?: string; nonce?: string; privateKey?: ReturnType<typeof generateKeyPairSync>["privateKey"] },
  ): Record<string, string> {
    const method = "POST";
    const path = "/bots/analyst/query";
    const source = "coder@alice";
    const timestamp = opts?.timestamp ?? String(Date.now());
    const nonce = opts?.nonce ?? randomUUID();
    const bodyStr = JSON.stringify(body);
    const envelope = `${method}\n${path}\n${source}\n${timestamp}\n${nonce}\n${bodyStr}`;
    const privateKey = opts?.privateKey ?? aliceKeyPair.privateKey;
    const sig = sign(null, Buffer.from(envelope), privateKey);

    return {
      "content-type": "application/json",
      cookie: makeAuthCookie(),
      "x-mecha-source": source,
      "x-mecha-timestamp": timestamp,
      "x-mecha-nonce": nonce,
      "x-mecha-signature": sig.toString("base64"),
    };
  }

  it("accepts valid Ed25519 request signature", async () => {
    const body = { message: "signed request" };
    const headers = makeSignedHeaders(body);

    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
  });

  it("rejects expired timestamp (>5min)", async () => {
    const body = { message: "old request" };
    const staleTimestamp = String(Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const headers = makeSignedHeaders(body, { timestamp: staleTimestamp });

    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
    const responseBody = await res.json() as Record<string, unknown>;
    expect(responseBody.error).toContain("Timestamp");
  });

  it("rejects nonce reuse within window", async () => {
    const body = { message: "nonce test" };
    const nonce = randomUUID();
    const headers = makeSignedHeaders(body, { nonce });

    // First request — should succeed
    const res1 = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);

    // Second request with same nonce — should be rejected
    const headers2 = makeSignedHeaders(body, { nonce });
    const res2 = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers: headers2,
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(401);
    const responseBody = await res2.json() as Record<string, unknown>;
    expect(responseBody.error).toContain("Nonce");
  });

  it("rejects signature with wrong private key", async () => {
    const { privateKey: wrongKey } = generateKeyPairSync("ed25519");
    const body = { message: "wrong key" };
    const headers = makeSignedHeaders(body, { privateKey: wrongKey });

    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it("rejects request body tampering (sign one body, send another)", async () => {
    const signedBody = { message: "original" };
    const headers = makeSignedHeaders(signedBody);

    // Send different body than what was signed
    const res = await fetch(`http://127.0.0.1:${bobPort}/bots/analyst/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "tampered" }),
    });
    expect(res.status).toBe(401);
  });
});
