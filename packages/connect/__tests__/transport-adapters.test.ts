import { describe, it, expect, vi } from "vitest";
import {
  relayToNoiseTransport,
  relayToChannelTransport,
  udpToNoiseTransport,
  udpToChannelTransport,
} from "../src/transport-adapters.js";
import type { RelayChannel } from "../src/types.js";

function makeRelayChannel(): RelayChannel & {
  _messageHandlers: Array<(data: Uint8Array) => void>;
  _closeHandlers: Array<(reason: string) => void>;
} {
  const ch = {
    _messageHandlers: [] as Array<(data: Uint8Array) => void>,
    _closeHandlers: [] as Array<(reason: string) => void>,
    send: vi.fn(),
    onMessage(h: (data: Uint8Array) => void) { ch._messageHandlers.push(h); },
    onClose(h: (reason: string) => void) { ch._closeHandlers.push(h); },
    close: vi.fn(),
  };
  return ch;
}

interface MockUdpSocket {
  send: ReturnType<typeof vi.fn>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  close: ReturnType<typeof vi.fn>;
  _handlers: Map<string, Array<(...args: unknown[]) => void>>;
}

function makeUdpSocket(): MockUdpSocket {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    send: vi.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    close: vi.fn(),
    _handlers: handlers,
  };
}

describe("relayToNoiseTransport", () => {
  it("send() delegates to relay channel", () => {
    const relay = makeRelayChannel();
    const transport = relayToNoiseTransport(relay);
    const data = new Uint8Array([1, 2, 3]);
    transport.send(data);
    expect(relay.send).toHaveBeenCalledWith(data);
  });

  it("receive() resolves when relay pushes a message", async () => {
    const relay = makeRelayChannel();
    const transport = relayToNoiseTransport(relay);

    const promise = transport.receive();
    const msg = new Uint8Array([10, 20]);
    for (const h of relay._messageHandlers) h(msg);

    expect(await promise).toEqual(msg);
  });

  it("receive() queues messages that arrive before pull", async () => {
    const relay = makeRelayChannel();
    const transport = relayToNoiseTransport(relay);

    // Push two messages before any receive()
    for (const h of relay._messageHandlers) h(new Uint8Array([1]));
    for (const h of relay._messageHandlers) h(new Uint8Array([2]));

    expect(await transport.receive()).toEqual(new Uint8Array([1]));
    expect(await transport.receive()).toEqual(new Uint8Array([2]));
  });
});

describe("relayToChannelTransport", () => {
  it("delegates send/onMessage/onClose/close to relay", () => {
    const relay = makeRelayChannel();
    const transport = relayToChannelTransport(relay);

    expect(transport.isOpen).toBe(true);

    const data = new Uint8Array([5]);
    transport.send(data);
    expect(relay.send).toHaveBeenCalledWith(data);

    const received: Uint8Array[] = [];
    transport.onMessage((d) => received.push(d));
    for (const h of relay._messageHandlers) h(new Uint8Array([6]));
    expect(received).toHaveLength(1);

    transport.close();
    expect(relay.close).toHaveBeenCalled();
    expect(transport.isOpen).toBe(false);
  });

  it("marks isOpen false when relay closes", () => {
    const relay = makeRelayChannel();
    const transport = relayToChannelTransport(relay);

    for (const h of relay._closeHandlers) h("peer gone");
    expect(transport.isOpen).toBe(false);
  });

  it("supports onError handler registration", () => {
    const relay = makeRelayChannel();
    const transport = relayToChannelTransport(relay);

    const errors: Error[] = [];
    transport.onError((err) => errors.push(err));
    // onError is a no-op sink for relay (relay has no error event)
    expect(errors).toHaveLength(0);
  });

  it("onClose fires on relay close", () => {
    const relay = makeRelayChannel();
    const transport = relayToChannelTransport(relay);

    const reasons: string[] = [];
    transport.onClose((r) => reasons.push(r));

    for (const h of relay._closeHandlers) h("relay shutdown");
    expect(reasons).toEqual(["relay shutdown"]);
  });
});

describe("udpToNoiseTransport", () => {
  it("send() delegates to socket with remote address", () => {
    const socket = makeUdpSocket();
    const transport = udpToNoiseTransport(socket as never, "1.2.3.4", 5000);

    const data = new Uint8Array([7, 8]);
    transport.send(data);
    expect(socket.send).toHaveBeenCalledWith(data, 5000, "1.2.3.4");
  });

  it("receive() resolves on incoming message", async () => {
    const socket = makeUdpSocket();
    const transport = udpToNoiseTransport(socket as never, "1.2.3.4", 5000);

    const promise = transport.receive();
    const msg = Buffer.from([9, 10]);
    for (const h of socket._handlers.get("message") ?? []) h(msg);

    const result = await promise;
    expect(result).toEqual(new Uint8Array([9, 10]));
  });
});

describe("udpToChannelTransport", () => {
  it("routes messages to registered handlers", () => {
    const socket = makeUdpSocket();
    const transport = udpToChannelTransport(socket as never, "1.2.3.4", 5000);

    const received: Uint8Array[] = [];
    transport.onMessage((d) => received.push(d));

    for (const h of socket._handlers.get("message") ?? []) h(Buffer.from([11]));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(new Uint8Array([11]));
  });

  it("send() delegates to socket", () => {
    const socket = makeUdpSocket();
    const transport = udpToChannelTransport(socket as never, "1.2.3.4", 5000);

    transport.send(new Uint8Array([12]));
    expect(socket.send).toHaveBeenCalledWith(new Uint8Array([12]), 5000, "1.2.3.4");
  });

  it("close() closes socket and marks not open", () => {
    const socket = makeUdpSocket();
    const transport = udpToChannelTransport(socket as never, "1.2.3.4", 5000);

    expect(transport.isOpen).toBe(true);
    transport.close();
    expect(socket.close).toHaveBeenCalled();
    expect(transport.isOpen).toBe(false);
  });

  it("fires onClose handlers when socket closes", () => {
    const socket = makeUdpSocket();
    const transport = udpToChannelTransport(socket as never, "1.2.3.4", 5000);

    const reasons: string[] = [];
    transport.onClose((r) => reasons.push(r));

    for (const h of socket._handlers.get("close") ?? []) h();
    expect(reasons).toEqual(["socket closed"]);
    expect(transport.isOpen).toBe(false);
  });

  it("fires onError handlers on socket error", () => {
    const socket = makeUdpSocket();
    const transport = udpToChannelTransport(socket as never, "1.2.3.4", 5000);

    const errors: Error[] = [];
    transport.onError((err) => errors.push(err));

    for (const h of socket._handlers.get("error") ?? []) h(new Error("boom"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("boom");
  });
});
