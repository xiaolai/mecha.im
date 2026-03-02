/**
 * Integration tests for mesh connectivity.
 *
 * Tests real rendezvous server + real crypto:
 * - Node registration on rendezvous
 * - Peer lookup
 * - Invite code creation and parsing
 * - Invite expiry
 * - WebSocket signaling between peers
 * - Relay token requests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, generateKeyPairSync, sign } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createServer,
  nodes,
  invites,
  relayPairs,
} from "@mecha/server";
import {
  createNodeIdentity,
  loadNodePrivateKey,
  loadNoiseKeyPair,
  generateNoiseKeyPair,
  fingerprint as computeFingerprint,
} from "@mecha/core";
import {
  createInviteCode,
  parseInviteCode,
} from "@mecha/connect";

let app: FastifyInstance;
let baseUrl: string;
let wsUrl: string;
const testSecret = randomBytes(32);

function makeIdentity(name: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const pubB64 = pubDer.toString("base64");
  const fp = `fp-${name}`;
  const npk = `npk-${name}`;

  function signRegistration(overrides?: { noisePublicKey?: string; fingerprint?: string }) {
    const payload = JSON.stringify({
      name,
      publicKey: pubB64,
      noisePublicKey: overrides?.noisePublicKey ?? npk,
      fingerprint: overrides?.fingerprint ?? fp,
    });
    const sig = sign(null, Buffer.from(payload), privateKey);
    return sig.toString("base64");
  }

  function registerMsg(requestId?: string) {
    return {
      type: "register" as const,
      name,
      publicKey: pubB64,
      noisePublicKey: npk,
      fingerprint: fp,
      signature: signRegistration(),
      requestId,
    };
  }

  return { name, publicKey: pubB64, publicKeyObj: publicKey, privateKey, fingerprint: fp, noisePublicKey: npk, signRegistration, registerMsg };
}

function connectWs(path = "/ws"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}${path}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendAndReceive(ws: WebSocket, msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
    ws.send(JSON.stringify(msg));
  });
}

function waitMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
  });
}

beforeEach(async () => {
  nodes.clear();
  invites.clear();
  relayPairs.clear();
  app = await createServer({
    port: 0,
    host: "127.0.0.1",
    relayUrl: "wss://relay.test",
    secret: testSecret,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
});

describe("connect: rendezvous registration", () => {
  it("node registers on rendezvous and appears in nodes map", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, alice.registerMsg("1"));
    expect(reply).toEqual({ type: "registered", ok: true, requestId: "1" });
    expect(nodes.size).toBe(1);
    expect(nodes.has("alice")).toBe(true);
    ws.close();
  });

  it("lookup returns correct metadata", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    await sendAndReceive(ws, alice.registerMsg("1"));

    const res = await fetch(`${baseUrl}/lookup/alice`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("alice");
    expect(body.publicKey).toBe(alice.publicKey);
    expect(body.noisePublicKey).toBe(alice.noisePublicKey);
    expect(body.fingerprint).toBe(alice.fingerprint);
    expect(body.online).toBe(true);
    ws.close();
  });

  it("lookup for unregistered peer returns 404", async () => {
    const res = await fetch(`${baseUrl}/lookup/nobody`);
    expect(res.status).toBe(404);
  });

  it("lookup via WS returns peer info", async () => {
    const alice = makeIdentity("alice");
    const ws1 = await connectWs();
    await sendAndReceive(ws1, alice.registerMsg("1"));

    const ws2 = await connectWs();
    const reply = await sendAndReceive(ws2, { type: "lookup", peer: "alice", requestId: "2" });
    expect(reply.found).toBe(true);
    expect((reply.peer as Record<string, unknown>).name).toBe("alice");

    ws1.close(); ws2.close();
  });

  it("lookup via WS returns not found for unregistered peer", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, { type: "lookup", peer: "nobody", requestId: "1" });
    expect(reply.found).toBe(false);
    ws.close();
  });
});

describe("connect: signaling", () => {
  it("signal forwards to target peer", async () => {
    const alice = makeIdentity("alice");
    const bob = makeIdentity("bob");

    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("1"));
    const wsBob = await connectWs();
    await sendAndReceive(wsBob, bob.registerMsg("2"));

    const bobMsg = waitMessage(wsBob);
    wsAlice.send(JSON.stringify({ type: "signal", to: "bob", data: { type: "offer", candidates: [] } }));
    const received = await bobMsg;
    expect(received.type).toBe("signal");
    expect(received.from).toBe("alice");

    wsAlice.close(); wsBob.close();
  });

  it("request-relay returns token and notifies peer", async () => {
    const alice = makeIdentity("alice");
    const bob = makeIdentity("bob");

    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("1"));
    const wsBob = await connectWs();
    await sendAndReceive(wsBob, bob.registerMsg("2"));

    const bobMsg = waitMessage(wsBob);
    const reply = await sendAndReceive(wsAlice, { type: "request-relay", peer: "bob", requestId: "3" });
    expect(reply.type).toBe("relay-token");
    expect(reply.token).toBeDefined();

    const bobReceived = await bobMsg;
    expect(bobReceived.type).toBe("signal");
    expect((bobReceived.data as Record<string, unknown>).type).toBe("relay-ready");

    wsAlice.close(); wsBob.close();
  });

  it("cleans up on disconnect", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    await sendAndReceive(ws, alice.registerMsg("1"));
    expect(nodes.size).toBe(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(nodes.size).toBe(0);
  });
});

describe("connect: invite codes", () => {
  it("invite creation produces valid mecha:// code", async () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "invite-"));
    const identity = createNodeIdentity(mechaDir);
    const privateKey = loadNodePrivateKey(mechaDir)!;
    const noiseKp = loadNoiseKeyPair(mechaDir)!;

    const invite = await createInviteCode({
      identity,
      nodeName: "alice",
      noisePublicKey: noiseKp.publicKey,
      privateKey,
      rendezvousUrl: wsUrl,
    });

    expect(invite.code).toMatch(/^mecha:\/\/invite\//);
    expect(invite.token).toBeDefined();
    expect(invite.expiresAt).toBeDefined();

    // Parse should succeed
    const parsed = parseInviteCode(invite.code);
    expect(parsed.inviterName).toBe("alice");
    expect(parsed.inviterPublicKey).toBe(identity.publicKey);
    expect(parsed.inviterFingerprint).toBe(identity.fingerprint);
    expect(parsed.inviterNoisePublicKey).toBe(noiseKp.publicKey);
    expect(parsed.rendezvousUrl).toBe(wsUrl);

    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("parseInviteCode validates signature cryptographically", async () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "invite-sig-"));
    const identity = createNodeIdentity(mechaDir);
    const privateKey = loadNodePrivateKey(mechaDir)!;
    const noiseKp = loadNoiseKeyPair(mechaDir)!;

    const invite = await createInviteCode({
      identity,
      nodeName: "alice",
      noisePublicKey: noiseKp.publicKey,
      privateKey,
      rendezvousUrl: wsUrl,
    });

    // Tamper with the invite code — change one character in the base64url
    const encoded = invite.code.slice("mecha://invite/".length);
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    decoded.inviterName = "evil";
    const tampered = "mecha://invite/" + Buffer.from(JSON.stringify(decoded)).toString("base64url");

    expect(() => parseInviteCode(tampered)).toThrow("signature");

    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("expired invite (1s TTL) throws on parse", async () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "invite-exp-"));
    const identity = createNodeIdentity(mechaDir);
    const privateKey = loadNodePrivateKey(mechaDir)!;
    const noiseKp = loadNoiseKeyPair(mechaDir)!;

    const invite = await createInviteCode({
      identity,
      nodeName: "alice",
      noisePublicKey: noiseKp.publicKey,
      privateKey,
      rendezvousUrl: wsUrl,
      opts: { expiresIn: 1 }, // 1 second TTL
    });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    expect(() => parseInviteCode(invite.code)).toThrow("expired");

    rmSync(mechaDir, { recursive: true, force: true });
  });
});
