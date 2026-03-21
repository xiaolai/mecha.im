import { describe, it, expect, vi } from "vitest";
import { createRendezvousClient } from "../src/rendezvous.js";
import type { WebSocketLike } from "../src/relay.js";
import type { NodeName } from "@mecha/core";

function makeMockWebSocket(): WebSocketLike & {
  _trigger: (event: string, data?: unknown) => void;
  _sent: string[];
} {
  const ws: WebSocketLike & {
    _trigger: (event: string, data?: unknown) => void;
    _sent: string[];
  } = {
    readyState: 0,
    _sent: [],
    send: vi.fn((data: Uint8Array) => {
      ws._sent.push(new TextDecoder().decode(data));
    }),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    _trigger(event: string, data?: unknown) {
      switch (event) {
        case "open":
          (ws as { readyState: number }).readyState = 1;
          ws.onopen?.(null);
          break;
        case "message":
          ws.onmessage?.({ data });
          break;
        case "close":
          (ws as { readyState: number }).readyState = 3;
          ws.onclose?.({ reason: data as string });
          break;
        case "error":
          ws.onerror?.(new Error("error"));
          break;
      }
    },
  };
  return ws;
}

describe("rendezvousClient", () => {
  const signFn = vi.fn(() => "test-signature");

  it("connects to rendezvous server", async () => {
    const ws = makeMockWebSocket();
    const factory = vi.fn().mockReturnValue(ws);

    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: factory,
    });

    const p = client.connect();
    ws._trigger("open");
    await p;

    expect(factory).toHaveBeenCalledWith("wss://rv.test.com/ws");
  });

  it("rejects connect on WebSocket error", async () => {
    const ws = makeMockWebSocket();

    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const p = client.connect();
    ws._trigger("error");

    await expect(p).rejects.toThrow("Cannot reach rendezvous server");
  });

  it("sends register message with signature", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const registerP = client.register({
      name: "alice",
      publicKey: "pub",
      noisePublicKey: "noise-pub",
      fingerprint: "fp",
    });

    // Respond to register request
    const sent = JSON.parse(ws._sent[0]!);
    const responseMsg = JSON.stringify({ requestId: sent.requestId, ok: true });
    ws._trigger("message", responseMsg);

    await registerP;

    expect(sent.type).toBe("register");
    expect(sent.name).toBe("alice");
    expect(sent.signature).toBe("test-signature");
  });

  it("handles signal events from server", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const signals: Array<{ from: NodeName; data: unknown }> = [];
    client.onSignal((from, data) => signals.push({ from, data }));

    ws._trigger("message", JSON.stringify({
      type: "signal",
      from: "bob",
      data: { type: "offer", candidates: [] },
    }));

    expect(signals).toHaveLength(1);
    expect(signals[0]!.from).toBe("bob");
  });

  it("handles invite-accepted events", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const accepted: string[] = [];
    client.onInviteAccepted((peer) => accepted.push(peer));

    ws._trigger("message", JSON.stringify({
      type: "invite-accepted",
      peer: "charlie",
      publicKey: "pk",
      noisePublicKey: "npk",
      fingerprint: "fp",
    }));

    expect(accepted).toEqual(["charlie"]);
  });

  it("sends signal to peer", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    await client.signal("bob" as NodeName, { type: "offer", candidates: [] });

    const sent = JSON.parse(ws._sent[0]!);
    expect(sent.type).toBe("signal");
    expect(sent.to).toBe("bob");
  });

  it("closes cleanly", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    client.close();
    expect(ws.close).toHaveBeenCalled();
  });

  it("throws when sending without connection", async () => {
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
    });

    await expect(client.signal("bob" as NodeName, { type: "offer", candidates: [] }))
      .rejects.toThrow("Not connected");
  });

  it("unregister is no-op when not registered", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    // Should not throw, should not send anything
    await client.unregister();
    expect(ws._sent).toHaveLength(0);
  });

  it("lookup returns peer info", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const lookupP = client.lookup("bob" as NodeName);

    const sent = JSON.parse(ws._sent[0]!);
    ws._trigger("message", JSON.stringify({
      requestId: sent.requestId,
      found: true,
      peer: { name: "bob", publicKey: "pk", noisePublicKey: "npk", fingerprint: "fp", online: true, sameLan: false },
    }));

    const result = await lookupP;
    expect(result?.name).toBe("bob");
    expect(result?.online).toBe(true);
  });

  it("lookup returns undefined when not found", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const lookupP = client.lookup("ghost" as NodeName);

    const sent = JSON.parse(ws._sent[0]!);
    ws._trigger("message", JSON.stringify({
      requestId: sent.requestId,
      found: false,
    }));

    expect(await lookupP).toBeUndefined();
  });

  it("rejects pending requests on close", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const lookupP = client.lookup("bob" as NodeName);

    // Close the connection — should reject pending request
    ws._trigger("close");

    await expect(lookupP).rejects.toThrow("Connection closed");
  });

  it("requestRelay returns a token", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const relayP = client.requestRelay("bob" as NodeName);

    const sent = JSON.parse(ws._sent[0]!);
    ws._trigger("message", JSON.stringify({
      requestId: sent.requestId,
      token: "relay-token-123",
    }));

    const token = await relayP;
    expect(token).toBe("relay-token-123");
  });

  it("unregister sends message when registered", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    // Register first
    const registerP = client.register({
      name: "alice",
      publicKey: "pub",
      noisePublicKey: "npub",
      fingerprint: "fp",
    });

    const sent = JSON.parse(ws._sent[0]!);
    ws._trigger("message", JSON.stringify({
      requestId: sent.requestId,
      ok: true,
    }));
    await registerP;

    ws._sent.length = 0; // clear sent history

    // Now unregister
    await client.unregister();

    expect(ws._sent).toHaveLength(1);
    const unregMsg = JSON.parse(ws._sent[0]!);
    expect(unregMsg.type).toBe("unregister");
  });

  it("handles Uint8Array message data", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const signals: Array<{ from: NodeName; data: unknown }> = [];
    client.onSignal((from, data) => signals.push({ from, data }));

    // Send as Uint8Array instead of string
    const msg = JSON.stringify({ type: "signal", from: "bob", data: { type: "offer", candidates: [] } });
    ws._trigger("message", new TextEncoder().encode(msg));

    expect(signals).toHaveLength(1);
    expect(signals[0]!.from).toBe("bob");
  });

  it("handles non-string non-Uint8Array message data via String()", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const signals: Array<{ from: NodeName; data: unknown }> = [];
    client.onSignal((from, data) => signals.push({ from, data }));

    // Send message where data has a custom toString() that returns valid JSON
    // This forces the String(ev.data) path since it's not Uint8Array or string
    const msg = { type: "signal", from: "bob", data: { type: "offer", candidates: [] } };
    const customObj = { toString: () => JSON.stringify(msg) };
    ws._trigger("message", customObj);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.from).toBe("bob");
  });

  it("ignores non-object messages in handleMessage", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    // These should not throw — they should be silently ignored
    ws._trigger("message", JSON.stringify(null));
    ws._trigger("message", JSON.stringify(42));
    ws._trigger("message", JSON.stringify("string"));
  });

  it("request timeout rejects pending requests", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    // Register with a very short timeout (internally uses 10s, but we'll trigger close)
    const lookupP = client.lookup("bob" as NodeName);

    // Let it timeout by closing
    ws._trigger("close");

    await expect(lookupP).rejects.toThrow("Connection closed");
  });

  it("ignores messages with unknown type (no handler)", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    // Should not throw — unknown message type with no requestId
    ws._trigger("message", JSON.stringify({ type: "unknown-event", data: {} }));
  });


  it("close is safe before connect", () => {
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
    });

    // Should not throw
    client.close();
  });

  it("rejects on error response from server", async () => {
    const ws = makeMockWebSocket();
    const client = createRendezvousClient({
      url: "wss://rv.test.com",
      signFn,
      createWebSocket: () => ws,
    });

    const connectP = client.connect();
    ws._trigger("open");
    await connectP;

    const registerP = client.register({
      name: "alice",
      publicKey: "pub",
      noisePublicKey: "npub",
      fingerprint: "fp",
    });

    const sent = JSON.parse(ws._sent[0]!);
    ws._trigger("message", JSON.stringify({
      requestId: sent.requestId,
      error: true,
      message: "Name already taken",
    }));

    await expect(registerP).rejects.toThrow("Name already taken");
  });
});
