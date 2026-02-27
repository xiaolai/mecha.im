import { describe, it, expect, vi } from "vitest";
import { relayConnect } from "../src/relay.js";
import type { WebSocketLike } from "../src/relay.js";

function makeMockWebSocket(): WebSocketLike & { _trigger: (event: string, data?: unknown) => void } {
  const ws: WebSocketLike & { _trigger: (event: string, data?: unknown) => void } = {
    readyState: 0,
    send: vi.fn(),
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
          ws.onerror?.(new Error("ws error"));
          break;
      }
    },
  };
  return ws;
}

describe("relay", () => {
  describe("relayConnect", () => {
    it("connects and returns a relay channel", async () => {
      const ws = makeMockWebSocket();
      const factory = vi.fn().mockReturnValue(ws);

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "test-token",
        createWebSocket: factory,
      });

      // Simulate connection open
      ws._trigger("open");

      const channel = await promise;
      expect(factory).toHaveBeenCalledWith("wss://relay.test.com/relay?token=test-token");
      expect(channel).toBeDefined();
      expect(channel.send).toBeDefined();
      expect(channel.close).toBeDefined();
    });

    it("relays messages through channel", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      // Send data through channel
      const data = new Uint8Array([1, 2, 3]);
      channel.send(data);
      expect(ws.send).toHaveBeenCalledWith(data);
    });

    it("receives messages from channel", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      const received: Uint8Array[] = [];
      channel.onMessage((data) => received.push(data));

      ws._trigger("message", new Uint8Array([4, 5, 6]));

      expect(received).toHaveLength(1);
      expect(Array.from(received[0]!)).toEqual([4, 5, 6]);
    });

    it("receives ArrayBuffer messages", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      const received: Uint8Array[] = [];
      channel.onMessage((data) => received.push(data));

      const ab = new ArrayBuffer(3);
      new Uint8Array(ab).set([7, 8, 9]);
      ws._trigger("message", ab);

      expect(received).toHaveLength(1);
      expect(Array.from(received[0]!)).toEqual([7, 8, 9]);
    });

    it("handles string message data (ignored)", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      const received: Uint8Array[] = [];
      channel.onMessage((data) => received.push(data));

      // String data should be ignored (not Uint8Array or ArrayBuffer)
      ws.onmessage?.({ data: "text message" });

      expect(received).toHaveLength(0);
    });

    it("emits close with default reason when undefined", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      const reasons: string[] = [];
      channel.onClose((r) => reasons.push(r));

      // Close with no reason
      ws.onclose?.({ reason: undefined });

      expect(reasons).toEqual(["connection closed"]);
    });

    it("emits close event", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      const reasons: string[] = [];
      channel.onClose((r) => reasons.push(r));

      ws._trigger("close", "peer left");

      expect(reasons).toEqual(["peer left"]);
    });

    it("rejects on WebSocket error", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("error");

      await expect(promise).rejects.toThrow("Relay WebSocket error");
    });

    it("rejects on timeout", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        timeoutMs: 50,
        createWebSocket: () => ws,
      });

      // Don't trigger open — let it timeout
      await expect(promise).rejects.toThrow("timeout");
    });

    it("does not send when readyState is not OPEN", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      // Close the websocket
      (ws as { readyState: number }).readyState = 3;
      channel.send(new Uint8Array([1]));
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("rejects when websocket closes before open", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      // Close before open
      ws._trigger("close", "server rejected");

      await expect(promise).rejects.toThrow("Relay connection closed before open");
    });

    it("close closes the websocket", async () => {
      const ws = makeMockWebSocket();

      const promise = relayConnect({
        relayUrl: "wss://relay.test.com",
        token: "tok",
        createWebSocket: () => ws,
      });

      ws._trigger("open");
      const channel = await promise;

      channel.close();
      expect(ws.close).toHaveBeenCalled();
    });
  });
});
