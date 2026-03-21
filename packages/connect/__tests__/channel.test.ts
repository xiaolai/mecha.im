import { describe, it, expect, vi } from "vitest";
import { createSecureChannel } from "../src/channel.js";
import type { ChannelTransport } from "../src/channel.js";
import type { NoiseCipher, ConnectionType } from "../src/types.js";
import type { NodeName } from "@mecha/core";

function makeCipher(): NoiseCipher {
  return {
    encrypt: vi.fn((data: Uint8Array) => {
      // Simple XOR "encryption" for testing
      const result = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) result[i] = data[i]! ^ 0x42;
      return result;
    }),
    decrypt: vi.fn((data: Uint8Array) => {
      const result = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) result[i] = data[i]! ^ 0x42;
      return result;
    }),
    rekey: vi.fn(),
  };
}

function makeTransport(): ChannelTransport & {
  _messageHandlers: Array<(data: Uint8Array) => void>;
  _closeHandlers: Array<(reason: string) => void>;
  _errorHandlers: Array<(err: Error) => void>;
  _open: boolean;
} {
  const t = {
    _messageHandlers: [] as Array<(data: Uint8Array) => void>,
    _closeHandlers: [] as Array<(reason: string) => void>,
    _errorHandlers: [] as Array<(err: Error) => void>,
    _open: true,
    send: vi.fn(),
    onMessage(h: (data: Uint8Array) => void) { t._messageHandlers.push(h); },
    onClose(h: (reason: string) => void) { t._closeHandlers.push(h); },
    onError(h: (err: Error) => void) { t._errorHandlers.push(h); },
    close: vi.fn(() => { t._open = false; }),
    get isOpen() { return t._open; },
  };
  return t;
}

describe("SecureChannel", () => {
  const PEER = "bob" as NodeName;
  const TYPE: ConnectionType = "hole-punched";
  const FP = "abc123";

  it("sends encrypted data through transport", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const data = new TextEncoder().encode("hello");
    ch.send(data);

    expect(cipher.encrypt).toHaveBeenCalledWith(data);
    expect(transport.send).toHaveBeenCalled();
  });

  it("decrypts incoming messages", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const received: Uint8Array[] = [];
    ch.onMessage((data) => received.push(data));

    // Simulate incoming encrypted message
    // "hello" = [0x68, 0x65, 0x6c, 0x6c, 0x6f] XOR 0x42 = [0x2a, 0x27, 0x2e, 0x2e, 0x2d]
    const encrypted = new Uint8Array([0x2a, 0x27, 0x2e, 0x2e, 0x2d]);
    for (const h of transport._messageHandlers) h(encrypted);

    expect(received).toHaveLength(1);
    expect(new TextDecoder().decode(received[0]!)).toBe("hello");
  });

  it("emits error on decrypt failure", () => {
    const cipher = makeCipher();
    (cipher.decrypt as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("bad"); });
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const errors: Error[] = [];
    ch.onError((err) => errors.push(err));

    for (const h of transport._messageHandlers) h(new Uint8Array(10));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("bad");
  });

  it("propagates transport close", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const reasons: string[] = [];
    ch.onClose((r) => reasons.push(r));

    for (const h of transport._closeHandlers) h("peer disconnected");

    expect(reasons).toEqual(["peer disconnected"]);
    expect(ch.isOpen).toBe(false);
  });

  it("propagates transport errors", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const errors: Error[] = [];
    ch.onError((e) => errors.push(e));

    for (const h of transport._errorHandlers) h(new Error("socket error"));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("socket error");
  });

  it("throws when sending on closed channel", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    ch.close();

    expect(() => ch.send(new Uint8Array(1))).toThrow("Channel is closed");
  });

  it("close notifies close handlers with local close", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const reasons: string[] = [];
    ch.onClose((r) => reasons.push(r));

    ch.close();

    expect(reasons).toEqual(["local close"]);
  });

  it("close is idempotent", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    ch.close();
    ch.close(); // Should not throw
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error thrown during decrypt", () => {
    const cipher = makeCipher();
    (cipher.decrypt as ReturnType<typeof vi.fn>).mockImplementation(() => { throw "string-error"; });
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const errors: Error[] = [];
    ch.onError((err) => errors.push(err));

    for (const h of transport._messageHandlers) h(new Uint8Array(10));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("string-error");
  });

  it("allows setting latencyMs", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    expect(ch.latencyMs).toBe(0);
    (ch as unknown as { latencyMs: number }).latencyMs = 42;
    expect(ch.latencyMs).toBe(42);
  });

  it("isOpen returns false when transport is closed", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    expect(ch.isOpen).toBe(true);
    // Close transport but not the channel's own state
    transport._open = false;
    expect(ch.isOpen).toBe(false);
  });

  it("offMessage removes a registered handler", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    const received: Uint8Array[] = [];
    const handler = (data: Uint8Array) => received.push(data);
    ch.onMessage(handler);

    // First message — handler is registered
    const encrypted1 = new Uint8Array([0x2a, 0x27, 0x2e, 0x2e, 0x2d]);
    for (const h of transport._messageHandlers) h(encrypted1);
    expect(received).toHaveLength(1);

    // Remove the handler
    ch.offMessage(handler);

    // Second message — handler should NOT be called
    for (const h of transport._messageHandlers) h(encrypted1);
    expect(received).toHaveLength(1);
  });

  it("offMessage is no-op for unregistered handler", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    // Should not throw
    ch.offMessage(() => {});
  });

  it("exposes readonly properties", () => {
    const cipher = makeCipher();
    const transport = makeTransport();
    const ch = createSecureChannel({ peer: PEER, type: TYPE, peerFingerprint: FP, cipher, transport });

    expect(ch.peer).toBe(PEER);
    expect(ch.type).toBe(TYPE);
    expect(ch.peerFingerprint).toBe(FP);
    expect(ch.latencyMs).toBe(0);
    expect(ch.isOpen).toBe(true);
  });
});
