import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createServer, nodes, invites, relayPairs, getIssuedRelayTokens } from "../src/index.js";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { generateKeyPairSync, sign } from "node:crypto";

let app: FastifyInstance;
let baseUrl: string;
let wsUrl: string;

beforeEach(async () => {
  nodes.clear();
  invites.clear();
  relayPairs.clear();
  app = await createServer({ port: 0, host: "127.0.0.1", relayUrl: "wss://relay.test" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
});

// --- Crypto helper ---

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

  function registerMsg(requestId?: string, overrides?: { noisePublicKey?: string; fingerprint?: string }) {
    return {
      type: "register" as const,
      name,
      publicKey: pubB64,
      noisePublicKey: overrides?.noisePublicKey ?? npk,
      fingerprint: overrides?.fingerprint ?? fp,
      signature: signRegistration(overrides),
      requestId,
    };
  }

  return { name, publicKey: pubB64, privateKey, fingerprint: fp, noisePublicKey: npk, signRegistration, registerMsg };
}

// --- Helper ---

function connectWs(path = "/ws"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}${path}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendAndReceive(ws: WebSocket, msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(String(data)));
    });
    ws.send(JSON.stringify(msg));
  });
}

function waitMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(String(data)));
    });
  });
}

// --- Health check ---

describe("healthz", () => {
  it("returns status ok", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.nodes).toBe(0);
  });
});

// --- REST lookup ---

describe("GET /lookup/:name", () => {
  it("returns 404 for unknown node", async () => {
    const res = await fetch(`${baseUrl}/lookup/unknown`);
    expect(res.status).toBe(404);
  });
});

// --- Signaling ---

describe("signaling", () => {
  it("register + lookup", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, alice.registerMsg("1"));
    expect(reply).toEqual({ type: "registered", ok: true, requestId: "1" });
    expect(nodes.size).toBe(1);

    // REST lookup
    const res = await fetch(`${baseUrl}/lookup/alice`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("alice");
    expect(body.online).toBe(true);

    ws.close();
  });

  it("rejects register with missing fields", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, {
      type: "register",
      name: "",
      publicKey: "",
      fingerprint: "",
      requestId: "1",
    });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("INVALID_REGISTER");
    ws.close();
  });

  it("handles invalid JSON", async () => {
    const ws = await connectWs();
    const reply = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (data) => resolve(JSON.parse(String(data))));
      ws.send("not json{{{");
    });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("PARSE_ERROR");
    ws.close();
  });

  it("rejects register with missing signature", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, {
      type: "register", name: "alice", publicKey: "pk", noisePublicKey: "npk",
      fingerprint: "fp", requestId: "1",
    });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("MISSING_SIGNATURE");
    ws.close();
  });

  it("rejects register with invalid signature", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, {
      type: "register", name: "alice", publicKey: "pk", noisePublicKey: "npk",
      fingerprint: "fp", signature: "bad-sig", requestId: "1",
    });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("INVALID_SIGNATURE");
    ws.close();
  });

  it("evicts previous connection for same name (same key)", async () => {
    const alice = makeIdentity("alice");
    const ws1 = await connectWs();
    await sendAndReceive(ws1, alice.registerMsg("1"));

    const ws2 = await connectWs();
    await sendAndReceive(ws2, alice.registerMsg("2"));

    expect(nodes.size).toBe(1);
    expect(nodes.get("alice")!.publicKey).toBe(alice.publicKey);

    ws1.close();
    ws2.close();
  });

  it("rejects re-register with different key (key pinning)", async () => {
    const alice1 = makeIdentity("alice");
    const ws1 = await connectWs();
    await sendAndReceive(ws1, alice1.registerMsg("1"));

    const alice2 = makeIdentity("alice"); // different keypair, same name
    const ws2 = await connectWs();
    const reply = await sendAndReceive(ws2, alice2.registerMsg("2"));
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("KEY_MISMATCH");

    ws1.close();
    ws2.close();
  });

  it("unregister removes node", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    await sendAndReceive(ws, alice.registerMsg("1"));
    expect(nodes.size).toBe(1);

    ws.send(JSON.stringify({ type: "unregister" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(nodes.size).toBe(0);

    ws.close();
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

  it("signal forwards to target peer", async () => {
    const alice = makeIdentity("alice");
    const bob = makeIdentity("bob");

    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("1"));

    const wsBob = await connectWs();
    await sendAndReceive(wsBob, bob.registerMsg("2"));

    // Alice signals Bob
    const bobMsg = waitMessage(wsBob);
    wsAlice.send(JSON.stringify({ type: "signal", to: "bob", data: { type: "offer", candidates: [] } }));

    const received = await bobMsg;
    expect(received.type).toBe("signal");
    expect(received.from).toBe("alice");

    wsAlice.close();
    wsBob.close();
  });

  it("signal errors if not registered", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, { type: "signal", to: "bob", data: {} });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("NOT_REGISTERED");
    ws.close();
  });

  it("signal errors if peer offline", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    await sendAndReceive(ws, alice.registerMsg("1"));
    const reply = await sendAndReceive(ws, { type: "signal", to: "bob", data: {} });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("PEER_OFFLINE");
    ws.close();
  });

  it("ping responds with pong", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, { type: "ping" });
    expect(reply.type).toBe("pong");
    ws.close();
  });

  it("lookup via WS returns peer info", async () => {
    const alice = makeIdentity("alice");
    const ws1 = await connectWs();
    await sendAndReceive(ws1, alice.registerMsg("1"));

    const ws2 = await connectWs();
    const reply = await sendAndReceive(ws2, { type: "lookup", peer: "alice", requestId: "2" });
    expect(reply.found).toBe(true);
    expect((reply.peer as Record<string, unknown>).name).toBe("alice");

    ws1.close();
    ws2.close();
  });

  it("lookup via WS returns not found", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, { type: "lookup", peer: "nobody", requestId: "1" });
    expect(reply.found).toBe(false);
    ws.close();
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
    expect(reply.relayUrl).toBe("wss://relay.test");

    const bobReceived = await bobMsg;
    expect(bobReceived.type).toBe("signal");
    expect((bobReceived.data as Record<string, unknown>).type).toBe("relay-ready");

    wsAlice.close();
    wsBob.close();
  });

  it("request-relay works when peer is offline", async () => {
    const alice = makeIdentity("alice");
    const ws = await connectWs();
    await sendAndReceive(ws, alice.registerMsg("1"));
    // Request relay to offline peer — should still return token
    const reply = await sendAndReceive(ws, { type: "request-relay", peer: "nobody", requestId: "2" });
    expect(reply.type).toBe("relay-token");
    expect(reply.token).toBeDefined();
    ws.close();
  });

  it("request-relay errors if not registered", async () => {
    const ws = await connectWs();
    const reply = await sendAndReceive(ws, { type: "request-relay", peer: "bob", requestId: "1" });
    expect(reply.type).toBe("error");
    expect(reply.code).toBe("NOT_REGISTERED");
    ws.close();
  });
});

// --- Invites ---

describe("invite REST", () => {
  it("create + get + accept invite", async () => {
    // Register inviter via WS with real Ed25519 signature
    const alice = makeIdentity("alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("1"));

    // Create invite
    const createRes = await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "test-token-123",
        inviterName: "alice",
        inviterPublicKey: alice.publicKey,
        inviterFingerprint: alice.fingerprint,
        inviterNoisePublicKey: alice.noisePublicKey,
        expiresAt: Date.now() + 86_400_000,
      }),
    });
    expect(createRes.status).toBe(201);

    // Get invite
    const getRes = await fetch(`${baseUrl}/invite/test-token-123`);
    expect(getRes.status).toBe(200);
    const invite = await getRes.json() as Record<string, unknown>;
    expect(invite.inviterName).toBe("alice");

    // Accept invite
    const acceptMsg = waitMessage(wsAlice);
    const acceptRes = await fetch(`${baseUrl}/invite/test-token-123/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "bob",
        publicKey: "pk-b",
        fingerprint: "fp-b",
        noisePublicKey: "npk-b",
      }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptBody = await acceptRes.json() as Record<string, unknown>;
    expect(acceptBody.ok).toBe(true);
    expect((acceptBody.inviter as Record<string, unknown>).name).toBe("alice");

    // Alice should have received invite-accepted notification
    const notification = await acceptMsg;
    expect(notification.type).toBe("invite-accepted");
    expect(notification.peer).toBe("bob");

    wsAlice.close();
  });

  it("rejects invite creation with missing fields", async () => {
    const res = await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown invite", async () => {
    const res = await fetch(`${baseUrl}/invite/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns 410 for consumed invite", async () => {
    // Register inviter first
    const alice = makeIdentity("alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("r1"));

    await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "consumed-token",
        inviterName: "alice",
        expiresAt: Date.now() + 86_400_000,
      }),
    });

    // Accept it
    await fetch(`${baseUrl}/invite/consumed-token/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", publicKey: "pk", fingerprint: "fp" }),
    });

    // Try again
    const res = await fetch(`${baseUrl}/invite/consumed-token`);
    expect(res.status).toBe(410);

    // Try accept again
    const acceptRes = await fetch(`${baseUrl}/invite/consumed-token/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "charlie", publicKey: "pk2", fingerprint: "fp2" }),
    });
    expect(acceptRes.status).toBe(410);
    wsAlice.close();
  });

  it("returns 410 for expired invite", async () => {
    // Register inviter first
    const alice = makeIdentity("alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("r1"));

    await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "expired-token",
        inviterName: "alice",
        expiresAt: Date.now() - 1000, // already expired
      }),
    });

    const res = await fetch(`${baseUrl}/invite/expired-token`);
    expect(res.status).toBe(410);
    wsAlice.close();
  });

  it("returns 400 for accept with missing fields", async () => {
    // Register inviter first
    const alice = makeIdentity("alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("r1"));

    await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "accept-missing",
        inviterName: "alice",
        expiresAt: Date.now() + 86_400_000,
      }),
    });

    const res = await fetch(`${baseUrl}/invite/accept-missing/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    wsAlice.close();
  });

  it("returns 404 for accept of unknown invite", async () => {
    const res = await fetch(`${baseUrl}/invite/unknown/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", publicKey: "pk", fingerprint: "fp" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 429 when invite limit reached", async () => {
    // Create server with tiny limit
    await app.close();
    nodes.clear(); invites.clear(); relayPairs.clear();
    app = await createServer({ port: 0, host: "127.0.0.1", relayUrl: "wss://relay.test", inviteMaxPending: 1 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    const localWsUrl = `ws://127.0.0.1:${port}`;

    // Register both inviters
    const alice = makeIdentity("alice");
    const bob = makeIdentity("bob");
    const wsAlice = new WebSocket(`${localWsUrl}/ws`);
    await new Promise<void>((resolve, reject) => { wsAlice.on("open", () => resolve()); wsAlice.on("error", reject); });
    wsAlice.send(JSON.stringify(alice.registerMsg("r1")));
    await new Promise<void>(r => wsAlice.once("message", () => r()));
    const wsBob = new WebSocket(`${localWsUrl}/ws`);
    await new Promise<void>((resolve, reject) => { wsBob.on("open", () => resolve()); wsBob.on("error", reject); });
    wsBob.send(JSON.stringify(bob.registerMsg("r2")));
    await new Promise<void>(r => wsBob.once("message", () => r()));

    // First invite — ok
    await fetch(`${url}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t1", inviterName: "alice", expiresAt: Date.now() + 86_400_000 }),
    });

    // Second invite — 429
    const res = await fetch(`${url}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t2", inviterName: "bob", expiresAt: Date.now() + 86_400_000 }),
    });
    expect(res.status).toBe(429);
    wsAlice.close(); wsBob.close();
  });

  it("purges expired invites when limit reached", async () => {
    await app.close();
    nodes.clear(); invites.clear(); relayPairs.clear();
    app = await createServer({ port: 0, host: "127.0.0.1", relayUrl: "wss://relay.test", inviteMaxPending: 1 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    const localWsUrl = `ws://127.0.0.1:${port}`;

    // Register both inviters
    const alice = makeIdentity("alice");
    const bob = makeIdentity("bob");
    const wsAlice = new WebSocket(`${localWsUrl}/ws`);
    await new Promise<void>((resolve, reject) => { wsAlice.on("open", () => resolve()); wsAlice.on("error", reject); });
    wsAlice.send(JSON.stringify(alice.registerMsg("r1")));
    await new Promise<void>(r => wsAlice.once("message", () => r()));
    const wsBob = new WebSocket(`${localWsUrl}/ws`);
    await new Promise<void>((resolve, reject) => { wsBob.on("open", () => resolve()); wsBob.on("error", reject); });
    wsBob.send(JSON.stringify(bob.registerMsg("r2")));
    await new Promise<void>(r => wsBob.once("message", () => r()));

    // First invite — already expired
    await fetch(`${url}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "expired", inviterName: "alice", expiresAt: Date.now() - 1000 }),
    });

    // Second invite — should succeed after purge
    const res = await fetch(`${url}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "fresh", inviterName: "bob", expiresAt: Date.now() + 86_400_000 }),
    });
    expect(res.status).toBe(201);
    wsAlice.close(); wsBob.close();
  });

  it("accepts invite without inviter online (no notification)", async () => {
    // Register inviter, create invite, then disconnect
    const alice = makeIdentity("offline-alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("r1"));

    await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "offline-inviter",
        inviterName: "offline-alice",
        expiresAt: Date.now() + 86_400_000,
      }),
    });

    // Disconnect inviter
    wsAlice.close();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`${baseUrl}/invite/offline-inviter/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", publicKey: "pk", fingerprint: "fp" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 410 for accept of expired invite", async () => {
    // Register inviter first
    const alice = makeIdentity("alice");
    const wsAlice = await connectWs();
    await sendAndReceive(wsAlice, alice.registerMsg("r1"));

    await fetch(`${baseUrl}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "expired-accept",
        inviterName: "alice",
        expiresAt: Date.now() - 1000,
      }),
    });

    const res = await fetch(`${baseUrl}/invite/expired-accept/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", publicKey: "pk", fingerprint: "fp" }),
    });
    expect(res.status).toBe(410);
    wsAlice.close();
  });
});

// --- Relay ---

describe("relay", () => {
  it("pairs two peers and relays messages", async () => {
    const token = "relay-test-token";
    getIssuedRelayTokens()!.add(token);
    const ws1 = await connectWs(`/relay?token=${token}`);

    const ws2Promise = connectWs(`/relay?token=${token}`);
    const ws2 = await ws2Promise;

    // ws1 → ws2
    const msg1 = new Promise<Buffer>((resolve) => {
      ws2.once("message", (data) => resolve(data as Buffer));
    });
    ws1.send(Buffer.from("hello from 1"));
    const received1 = await msg1;
    expect(received1.toString()).toBe("hello from 1");

    // ws2 → ws1
    const msg2 = new Promise<Buffer>((resolve) => {
      ws1.once("message", (data) => resolve(data as Buffer));
    });
    ws2.send(Buffer.from("hello from 2"));
    const received2 = await msg2;
    expect(received2.toString()).toBe("hello from 2");

    ws1.close();
    ws2.close();
  });

  it("closes ws without token", async () => {
    const ws = new WebSocket(`${wsUrl}/relay`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(4000);
  });

  it("rejects unissued relay token", async () => {
    const ws = new WebSocket(`${wsUrl}/relay?token=not-issued`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(4003);
  });

  it("first peer disconnect cleans up pair", async () => {
    const token = "cleanup-test";
    getIssuedRelayTokens()!.add(token);
    const ws1 = await connectWs(`/relay?token=${token}`);
    expect(relayPairs.size).toBe(1);

    ws1.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(relayPairs.size).toBe(0);
  });

  it("rejects when relay capacity reached", async () => {
    await app.close();
    nodes.clear(); invites.clear(); relayPairs.clear();
    app = await createServer({ port: 0, host: "127.0.0.1", relayUrl: "wss://relay.test", relayMaxPairs: 1 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const p = typeof addr === "object" && addr ? addr.port : 0;
    const localWsUrl = `ws://127.0.0.1:${p}`;

    // Fill capacity — pre-register tokens
    getIssuedRelayTokens()!.add("fill-1");
    getIssuedRelayTokens()!.add("fill-2");
    const ws1 = new WebSocket(`${localWsUrl}/relay?token=fill-1`);
    await new Promise<void>((resolve, reject) => { ws1.on("open", () => resolve()); ws1.on("error", reject); });

    // Exceed capacity
    const ws2 = new WebSocket(`${localWsUrl}/relay?token=fill-2`);
    const code = await new Promise<number>((resolve) => {
      ws2.on("close", (c) => resolve(c));
    });
    expect(code).toBe(4001);
    ws1.close();
  });

  it("first peer disconnect after pairing closes second peer", async () => {
    const token = "disconnect-first";
    getIssuedRelayTokens()!.add(token);
    const ws1 = await connectWs(`/relay?token=${token}`);
    const ws2 = await connectWs(`/relay?token=${token}`);

    const ws2Closed = new Promise<void>((resolve) => { ws2.on("close", () => resolve()); });
    ws1.close();
    await ws2Closed;

    expect(relayPairs.size).toBe(0);
  });

  it("second peer disconnect closes first peer", async () => {
    const token = "disconnect-test";
    getIssuedRelayTokens()!.add(token);
    const ws1 = await connectWs(`/relay?token=${token}`);
    const ws2 = await connectWs(`/relay?token=${token}`);

    const ws1Closed = new Promise<void>((resolve) => { ws1.on("close", () => resolve()); });
    ws2.close();
    await ws1Closed;

    expect(relayPairs.size).toBe(0);
  });
});
