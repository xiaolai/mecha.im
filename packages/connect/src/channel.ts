import type { NodeName } from "@mecha/core";
import type { SecureChannel, ConnectionType, NoiseCipher } from "./types.js";

export interface ChannelTransport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  onError(handler: (err: Error) => void): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface CreateChannelOpts {
  peer: NodeName;
  type: ConnectionType;
  peerFingerprint: string;
  cipher: NoiseCipher;
  transport: ChannelTransport;
}

/** Create a SecureChannel that encrypts/decrypts via a Noise cipher over a raw transport. */
export function createSecureChannel(opts: CreateChannelOpts): SecureChannel {
  const { peer, type, peerFingerprint, cipher, transport } = opts;
  let latencyMs = 0;
  let open = true;
  const messageHandlers: Array<(data: Uint8Array) => void> = [];
  const closeHandlers: Array<(reason: string) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  transport.onMessage((encrypted) => {
    try {
      const plaintext = cipher.decrypt(encrypted);
      for (const handler of messageHandlers) {
        try { handler(plaintext); } catch { /* isolate handler errors */ }
      }
    } catch (err) {
      for (const handler of errorHandlers) handler(err instanceof Error ? err : new Error(String(err)));
    }
  });

  transport.onClose((reason) => {
    /* v8 ignore start -- guard: transport onClose fires after local close */
    if (!open) return;
    /* v8 ignore stop */
    open = false;
    for (const handler of closeHandlers) handler(reason);
  });

  transport.onError((err) => {
    for (const handler of errorHandlers) handler(err);
  });

  return {
    get peer() { return peer; },
    get type() { return type; },
    get latencyMs() { return latencyMs; },
    get peerFingerprint() { return peerFingerprint; },
    get isOpen() { return open && transport.isOpen; },

    send(data: Uint8Array): void {
      if (!open) throw new Error("Channel is closed");
      const encrypted = cipher.encrypt(data);
      transport.send(encrypted);
    },

    onMessage(handler: (data: Uint8Array) => void): void {
      messageHandlers.push(handler);
    },

    offMessage(handler: (data: Uint8Array) => void): void {
      const idx = messageHandlers.indexOf(handler);
      if (idx >= 0) messageHandlers.splice(idx, 1);
    },

    onClose(handler: (reason: string) => void): void {
      closeHandlers.push(handler);
    },

    offClose(handler: (reason: string) => void): void {
      const idx = closeHandlers.indexOf(handler);
      if (idx >= 0) closeHandlers.splice(idx, 1);
    },

    onError(handler: (err: Error) => void): void {
      errorHandlers.push(handler);
    },

    /* v8 ignore start -- offError: exercised by channelFetch, unit tested via channel-fetch.test.ts mock */
    offError(handler: (err: Error) => void): void {
      const idx = errorHandlers.indexOf(handler);
      if (idx >= 0) errorHandlers.splice(idx, 1);
    },
    /* v8 ignore stop */

    close(): void {
      if (!open) return;
      open = false;
      transport.close();
      for (const handler of closeHandlers) handler("local close");
    },

    /** Internal: update latency measurement */
    set latencyMs(ms: number) { latencyMs = ms; },
  } as SecureChannel & { latencyMs: number };
}
