import { DEFAULTS } from "@mecha/core";
import type { RelayChannel } from "./types.js";

export interface RelayConnectOpts {
  relayUrl: string;
  token: string;
  timeoutMs?: number;
  /** Injected WebSocket constructor for testing */
  createWebSocket?: (url: string) => WebSocketLike;
}

/** Minimal WebSocket interface for relay connections. */
export interface WebSocketLike {
  readonly readyState: number;
  binaryType?: string;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const WS_OPEN = 1;

/** Connect to relay server and establish a relayed channel to peer. */
export async function relayConnect(opts: RelayConnectOpts): Promise<RelayChannel> {
  const {
    relayUrl,
    token,
    timeoutMs = DEFAULTS.RELAY_PAIR_TIMEOUT_MS,
    createWebSocket,
  } = opts;

  const url = `${relayUrl}/relay?token=${encodeURIComponent(token)}`;

  /* v8 ignore start -- real WebSocket fallback, tests always inject createWebSocket */
  const ws = createWebSocket ? createWebSocket(url) : new WebSocket(url);
  /* v8 ignore stop */

  // Ensure binary data arrives as ArrayBuffer (not Blob) in Node.js native WebSocket
  /* v8 ignore start -- binaryType only relevant for native WebSocket, tests inject mocks */
  if (ws.binaryType !== undefined) ws.binaryType = "arraybuffer";
  /* v8 ignore stop */

  return new Promise<RelayChannel>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Relay connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const messageHandlers: Array<(data: Uint8Array) => void> = [];
    const closeHandlers: Array<(reason: string) => void> = [];

    ws.onopen = () => {
      clearTimeout(timer);

      const channel: RelayChannel = {
        send(data: Uint8Array): void {
          if (ws.readyState === WS_OPEN) {
            ws.send(data);
          }
        },
        onMessage(handler: (data: Uint8Array) => void): void {
          messageHandlers.push(handler);
        },
        onClose(handler: (reason: string) => void): void {
          closeHandlers.push(handler);
        },
        close(): void {
          ws.close();
        },
      };

      resolve(channel);
    };

    ws.onmessage = (ev: { data: unknown }) => {
      const data = ev.data;
      let bytes: Uint8Array | undefined;
      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      }
      /* v8 ignore start -- Buffer subclass of Uint8Array; guard for edge runtimes */
      if (!bytes && typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        bytes = new Uint8Array(data);
      }
      /* v8 ignore stop */
      if (bytes) {
        /* v8 ignore start -- oversized frame guard requires real relay server */
        if (bytes.length > DEFAULTS.RELAY_MAX_MESSAGE_BYTES) {
          ws.close();
          return;
        }
        /* v8 ignore stop */
        for (const handler of messageHandlers) handler(bytes);
      }
      /* v8 ignore start -- string messages from relay are control frames, not user data */
      /* v8 ignore stop */
    };

    ws.onclose = (ev: { reason?: string }) => {
      clearTimeout(timer);
      const reason = ev.reason ?? "connection closed";
      for (const handler of closeHandlers) handler(reason);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Relay WebSocket error"));
    };
  });
}
