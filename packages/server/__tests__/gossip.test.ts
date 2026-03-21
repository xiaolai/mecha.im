import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, nodes, createGossipCache } from "../src/index.js";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let app: FastifyInstance;
let wsUrl: string;
let mechaDir: string;
const testSecret = randomBytes(32);

/** Track open WebSockets for cleanup */
const openSockets: WebSocket[] = [];

function makeIdentity(name: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const pubB64 = pubDer.toString("base64");

  return {
    name,
    publicKey: pubB64,
    privateKey,
    fingerprint: `fp-${name}`,
    signNonce(nonce: string) {
      const sig = sign(null, Buffer.from(nonce, "hex"), privateKey);
      return sig.toString("base64");
    },
  };
}

function writeNodes(dir: string, entries: Array<{ name: string; publicKey: string }>) {
  const nodes = entries.map((e) => ({
    name: e.name,
    host: "",
    port: 0,
    apiKey: "",
    publicKey: e.publicKey,
    fingerprint: `fp-${e.name}`,
    addedAt: new Date().toISOString(),
    managed: true,
  }));
  writeFileSync(join(dir, "nodes.json"), JSON.stringify(nodes));
}

/** Connect to gossip endpoint and eagerly capture the first message (challenge).
 * Registering the handler before 'open' fires avoids race conditions with process.nextTick. */
function connectGossip(): Promise<{ ws: WebSocket; challenge: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/gossip`);
    openSockets.push(ws);
    ws.once("message", (data) => {
      resolve({ ws, challenge: JSON.parse(String(data)) });
    });
    ws.on("error", reject);
  });
}

function waitMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(String(data)));
    });
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on("close", (code) => resolve(code));
  });
}

beforeEach(async () => {
  nodes.clear();
  mechaDir = mkdtempSync(join(tmpdir(), "gossip-test-"));
  writeNodes(mechaDir, []);

  app = await createServer({
    port: 0,
    host: "127.0.0.1",
    relayUrl: "wss://relay.test",
    secret: testSecret,
    mechaDir,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  // Terminate all open sockets before closing server
  for (const ws of openSockets) {
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
  }
  openSockets.length = 0;
  await app.close();
});

describe("gossip", () => {
  it("sends challenge on connect", async () => {
    const { challenge } = await connectGossip();
    expect(challenge.type).toBe("challenge");
    expect(typeof challenge.nonce).toBe("string");
    expect((challenge.nonce as string).length).toBe(64); // 32 bytes hex
  });

  it("authenticates known peer", async () => {
    const alice = makeIdentity("alice");
    writeNodes(mechaDir, [{ name: "alice", publicKey: alice.publicKey }]);

    const { ws, challenge } = await connectGossip();

    ws.send(JSON.stringify({
      type: "auth",
      name: "alice",
      signature: alice.signNonce(challenge.nonce as string),
      publicKey: alice.publicKey,
    }));

    const response = await waitMessage(ws);
    expect(response.type).toBe("authenticated");
  });

  it("rejects unknown peer", async () => {
    const { ws, challenge } = await connectGossip();
    const closePromise = waitClose(ws);

    const eve = makeIdentity("eve");
    ws.send(JSON.stringify({
      type: "auth",
      name: "eve",
      signature: eve.signNonce(challenge.nonce as string),
      publicKey: eve.publicKey,
    }));

    expect(await closePromise).toBe(4001);
  });

  it("rejects wrong public key", async () => {
    const alice = makeIdentity("alice");
    const eve = makeIdentity("eve");
    writeNodes(mechaDir, [{ name: "alice", publicKey: alice.publicKey }]);

    const { ws, challenge } = await connectGossip();
    const closePromise = waitClose(ws);

    ws.send(JSON.stringify({
      type: "auth",
      name: "alice",
      signature: eve.signNonce(challenge.nonce as string),
      publicKey: eve.publicKey, // wrong key
    }));

    expect(await closePromise).toBe(4001);
  });

  it("rejects invalid signature", async () => {
    const alice = makeIdentity("alice");
    writeNodes(mechaDir, [{ name: "alice", publicKey: alice.publicKey }]);

    const { ws, challenge } = await connectGossip();
    const closePromise = waitClose(ws);

    ws.send(JSON.stringify({
      type: "auth",
      name: "alice",
      signature: "invalid-signature",
      publicKey: alice.publicKey,
    }));

    expect(await closePromise).toBe(4001);
  });

  it("rejects non-auth message before authentication", async () => {
    const { ws } = await connectGossip();
    const closePromise = waitClose(ws);

    ws.send(JSON.stringify({ type: "gossip-push", records: [], vectorClock: {} }));

    expect(await closePromise).toBe(4001);
  });

  it("accepts gossip-push after authentication", async () => {
    const alice = makeIdentity("alice");
    writeNodes(mechaDir, [{ name: "alice", publicKey: alice.publicKey }]);

    const { ws, challenge } = await connectGossip();

    ws.send(JSON.stringify({
      type: "auth",
      name: "alice",
      signature: alice.signNonce(challenge.nonce as string),
      publicKey: alice.publicKey,
    }));

    const authResponse = await waitMessage(ws);
    expect(authResponse.type).toBe("authenticated");

    // Send gossip push with a peer record
    ws.send(JSON.stringify({
      type: "gossip-push",
      records: [{
        name: "bob",
        publicKey: "pk-bob",
        noisePublicKey: "npk-bob",
        fingerprint: "fp-bob",
        serverUrl: "ws://bob-server:7681",
        lastSeen: Math.floor(Date.now() / 1000),
        hopCount: 0,
      }],
      vectorClock: { alice: 1 },
    }));

    // Give a moment for the message to be processed
    await new Promise((r) => setTimeout(r, 50));

    // Verify the record is in gossip cache via REST lookup
    const res = await fetch(`http://127.0.0.1:${(app.server.address() as any).port}/lookup/bob`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("bob");
  });

  it("ignores records at max hop count", async () => {
    const alice = makeIdentity("alice");
    writeNodes(mechaDir, [{ name: "alice", publicKey: alice.publicKey }]);

    const { ws, challenge } = await connectGossip();

    ws.send(JSON.stringify({
      type: "auth",
      name: "alice",
      signature: alice.signNonce(challenge.nonce as string),
      publicKey: alice.publicKey,
    }));
    await waitMessage(ws); // authenticated

    // Send record at max hop count (3)
    ws.send(JSON.stringify({
      type: "gossip-push",
      records: [{
        name: "charlie",
        publicKey: "pk-charlie",
        noisePublicKey: "npk-charlie",
        fingerprint: "fp-charlie",
        serverUrl: "ws://charlie:7681",
        lastSeen: Math.floor(Date.now() / 1000),
        hopCount: 3,
      }],
      vectorClock: { alice: 1 },
    }));

    await new Promise((r) => setTimeout(r, 50));

    // Record should NOT be in cache (hop count too high)
    const res = await fetch(`http://127.0.0.1:${(app.server.address() as any).port}/lookup/charlie`);
    expect(res.status).toBe(404);
  });
});
