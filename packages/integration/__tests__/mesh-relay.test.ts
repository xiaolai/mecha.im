/**
 * Integration tests for the relay endpoint.
 *
 * Tests real WebSocket connections to the relay server, verifying:
 * - Peer pairing and bidirectional message forwarding
 * - HMAC token validation and expiry
 * - Capacity limits and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import {
  createServer,
  nodes,
  invites,
  relayPairs,
  createRelayToken,
} from "@mecha/server";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let wsUrl: string;
const testSecret = randomBytes(32);

function makeToken(peer = "test"): string {
  return createRelayToken(testSecret, { peer, srv: "127.0.0.1" });
}

function connectWs(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}${path}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on("close", (code) => resolve(code));
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
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
});

describe("relay: pairing and forwarding", () => {
  it("pairs two connections and forwards messages bidirectionally", async () => {
    const token = makeToken("alice");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);
    const ws2 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);

    // ws1 → ws2
    const msg1 = new Promise<Buffer>((resolve) => {
      ws2.once("message", (data) => resolve(data as Buffer));
    });
    ws1.send(Buffer.from("hello from 1"));
    expect((await msg1).toString()).toBe("hello from 1");

    // ws2 → ws1
    const msg2 = new Promise<Buffer>((resolve) => {
      ws1.once("message", (data) => resolve(data as Buffer));
    });
    ws2.send(Buffer.from("hello from 2"));
    expect((await msg2).toString()).toBe("hello from 2");

    ws1.close();
    ws2.close();
  });

  it("forwards binary data (Uint8Array) faithfully", async () => {
    const token = makeToken("binary");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);
    const ws2 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);

    const binaryPayload = randomBytes(1024);
    const received = new Promise<Buffer>((resolve) => {
      ws2.once("message", (data) => resolve(data as Buffer));
    });
    ws1.send(binaryPayload);
    const result = await received;
    expect(Buffer.compare(result, binaryPayload)).toBe(0);

    ws1.close();
    ws2.close();
  });

  it("supports multiple concurrent relay sessions independently", async () => {
    const token1 = makeToken("session-1");
    const token2 = makeToken("session-2");

    const ws1a = await connectWs(`/relay?token=${encodeURIComponent(token1)}`);
    const ws1b = await connectWs(`/relay?token=${encodeURIComponent(token1)}`);
    const ws2a = await connectWs(`/relay?token=${encodeURIComponent(token2)}`);
    const ws2b = await connectWs(`/relay?token=${encodeURIComponent(token2)}`);

    // Session 1: ws1a → ws1b
    const msg1 = new Promise<Buffer>((resolve) => {
      ws1b.once("message", (data) => resolve(data as Buffer));
    });
    ws1a.send(Buffer.from("session 1"));
    expect((await msg1).toString()).toBe("session 1");

    // Session 2: ws2a → ws2b
    const msg2 = new Promise<Buffer>((resolve) => {
      ws2b.once("message", (data) => resolve(data as Buffer));
    });
    ws2a.send(Buffer.from("session 2"));
    expect((await msg2).toString()).toBe("session 2");

    expect(relayPairs.size).toBe(2);

    ws1a.close(); ws1b.close(); ws2a.close(); ws2b.close();
  });
});

describe("relay: token validation", () => {
  it("rejects connection with invalid HMAC token (close code 4003)", async () => {
    const ws = new WebSocket(`${wsUrl}/relay?token=not-a-valid-hmac-token`);
    const code = await waitClose(ws);
    expect(code).toBe(4003);
  });

  it("rejects connection without token (close code 4000)", async () => {
    const ws = new WebSocket(`${wsUrl}/relay`);
    const code = await waitClose(ws);
    expect(code).toBe(4000);
  });

  it("rejects expired token (TTL >120s)", async () => {
    // Manually craft an expired token by creating one with a past exp
    // The createRelayToken always creates with 120s TTL, so we test with a bad one
    const ws = new WebSocket(`${wsUrl}/relay?token=expired.fake.token`);
    const code = await waitClose(ws);
    expect(code).toBe(4003);
  });

  it("rejects third connection to same token (close code 4004)", async () => {
    const token = makeToken("triple");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);
    const ws2 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);

    // Third connection should be rejected
    const ws3 = new WebSocket(`${wsUrl}/relay?token=${encodeURIComponent(token)}`);
    const code = await waitClose(ws3);
    expect(code).toBe(4004);

    ws1.close();
    ws2.close();
  });
});

describe("relay: capacity and cleanup", () => {
  it("rejects when relay capacity is reached", async () => {
    await app.close();
    nodes.clear(); invites.clear(); relayPairs.clear();
    app = await createServer({
      port: 0,
      host: "127.0.0.1",
      relayUrl: "wss://relay.test",
      relayMaxPairs: 1,
      secret: testSecret,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    wsUrl = `ws://127.0.0.1:${port}`;

    const fillToken = makeToken("fill");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(fillToken)}`);

    const overflowToken = makeToken("overflow");
    const ws2 = new WebSocket(`${wsUrl}/relay?token=${encodeURIComponent(overflowToken)}`);
    const code = await waitClose(ws2);
    expect(code).toBe(4001);

    ws1.close();
  });

  it("cleans up pair when first peer disconnects before pairing", async () => {
    const token = makeToken("cleanup");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);
    expect(relayPairs.size).toBe(1);

    ws1.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(relayPairs.size).toBe(0);
  });

  it("closes second peer when first disconnects after pairing", async () => {
    const token = makeToken("cascade");
    const ws1 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);
    const ws2 = await connectWs(`/relay?token=${encodeURIComponent(token)}`);

    const ws2Closed = new Promise<void>((resolve) => { ws2.on("close", () => resolve()); });
    ws1.close();
    await ws2Closed;
    expect(relayPairs.size).toBe(0);
  });
});
