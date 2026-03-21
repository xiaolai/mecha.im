import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { writeNodes } from "@mecha/core";
import type { NodeEntry } from "@mecha/core";
import {
  createAuthContext,
  verifyRequestSignature,
} from "../src/auth.js";
import type { FastifyRequest } from "fastify";

function makeRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/bots/analyst/query",
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

describe("verifyRequestSignature", () => {
  let mechaDir: string;
  let aliceKeyPair: ReturnType<typeof generateKeyPairSync>;
  let alicePubPem: string;
  let authCtx: ReturnType<typeof createAuthContext>;

  beforeAll(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "auth-test-"));
    aliceKeyPair = generateKeyPairSync("ed25519");
    alicePubPem = aliceKeyPair.publicKey.export({ type: "spki", format: "pem" }) as string;

    writeNodes(mechaDir, [{
      name: "alice" as NodeEntry["name"],
      host: "127.0.0.1",
      port: 9999,
      apiKey: "key",
      publicKey: alicePubPem,
      fingerprint: "fp-alice",
      addedAt: new Date().toISOString(),
    }]);

    authCtx = createAuthContext({ totpSecret: "secret" }, mechaDir);
  });

  afterAll(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  function makeSignedRequest(body: Record<string, unknown>, opts?: {
    timestamp?: string;
    nonce?: string;
    privateKey?: ReturnType<typeof generateKeyPairSync>["privateKey"];
  }) {
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
      req: makeRequest({
        headers: {
          "x-mecha-source": source,
          "x-mecha-timestamp": timestamp,
          "x-mecha-nonce": nonce,
          "x-mecha-signature": sig.toString("base64"),
        },
      }),
      rawBody: bodyStr,
    };
  }

  it("returns null when no signature headers are present", () => {
    const req = makeRequest();
    const result = verifyRequestSignature(req, "{}", authCtx);
    expect(result).toBeNull();
  });

  it("returns error for incomplete signature headers", () => {
    const req = makeRequest({
      headers: { "x-mecha-timestamp": String(Date.now()) },
    });
    const result = verifyRequestSignature(req, "{}", authCtx);
    expect(result).toContain("Incomplete");
  });

  it("accepts valid Ed25519 signature", () => {
    const body = { message: "test" };
    const { req, rawBody } = makeSignedRequest(body);
    const result = verifyRequestSignature(req, rawBody, authCtx);
    expect(result).toBeNull();
  });

  it("rejects expired timestamp", () => {
    const body = { message: "test" };
    const staleTs = String(Date.now() - 6 * 60 * 1000);
    const { req, rawBody } = makeSignedRequest(body, { timestamp: staleTs });
    const result = verifyRequestSignature(req, rawBody, authCtx);
    expect(result).toContain("Timestamp");
  });

  it("rejects nonce reuse", () => {
    const body = { message: "test" };
    const nonce = randomUUID();
    const { req: req1, rawBody: body1 } = makeSignedRequest(body, { nonce });
    verifyRequestSignature(req1, body1, authCtx);

    const { req: req2, rawBody: body2 } = makeSignedRequest(body, { nonce });
    const result = verifyRequestSignature(req2, body2, authCtx);
    expect(result).toContain("Nonce");
  });

  it("rejects signature with wrong private key", () => {
    const { privateKey: wrongKey } = generateKeyPairSync("ed25519");
    const body = { message: "test" };
    const { req, rawBody } = makeSignedRequest(body, { privateKey: wrongKey });
    const result = verifyRequestSignature(req, rawBody, authCtx);
    expect(result).toContain("Invalid signature");
  });

  it("rejects tampered body", () => {
    const body = { message: "original" };
    const { req } = makeSignedRequest(body);
    const result = verifyRequestSignature(req, JSON.stringify({ message: "tampered" }), authCtx);
    expect(result).toContain("Invalid signature");
  });

  it("rejects signature without node in source", () => {
    const body = { message: "test" };
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const source = "admin"; // no @node
    const bodyStr = JSON.stringify(body);
    const envelope = `POST\n/bots/analyst/query\n${source}\n${timestamp}\n${nonce}\n${bodyStr}`;
    const sig = sign(null, Buffer.from(envelope), aliceKeyPair.privateKey);

    const req = makeRequest({
      headers: {
        "x-mecha-source": source,
        "x-mecha-timestamp": timestamp,
        "x-mecha-nonce": nonce,
        "x-mecha-signature": sig.toString("base64"),
      },
    });
    const result = verifyRequestSignature(req, bodyStr, authCtx);
    expect(result).toContain("no node");
  });

  it("rejects signature from unknown node", () => {
    const body = { message: "test" };
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const source = "coder@unknown";
    const bodyStr = JSON.stringify(body);
    const envelope = `POST\n/bots/analyst/query\n${source}\n${timestamp}\n${nonce}\n${bodyStr}`;
    const sig = sign(null, Buffer.from(envelope), aliceKeyPair.privateKey);

    const req = makeRequest({
      headers: {
        "x-mecha-source": source,
        "x-mecha-timestamp": timestamp,
        "x-mecha-nonce": nonce,
        "x-mecha-signature": sig.toString("base64"),
      },
    });
    const result = verifyRequestSignature(req, bodyStr, authCtx);
    expect(result).toContain("unknown node");
  });
});
