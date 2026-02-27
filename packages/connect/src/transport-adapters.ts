import type { NoiseTransport, RelayChannel } from "./types.js";
import type { ChannelTransport } from "./channel.js";

/**
 * Adapters between incompatible transport shapes used by the connect pipeline.
 *
 * relay ↔ NoiseTransport (for Noise handshake over relay)
 * relay ↔ ChannelTransport (for SecureChannel over relay)
 * UDP socket ↔ NoiseTransport (for Noise handshake over hole-punched UDP)
 * UDP socket ↔ ChannelTransport (for SecureChannel over hole-punched UDP)
 */

// --- Async queue for converting push-based onMessage to pull-based receive() ---

interface AsyncQueue<T> {
  push(item: T): void;
  pull(): Promise<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffer: T[] = [];
  const waiters: Array<(item: T) => void> = [];

  return {
    push(item: T): void {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(item);
      } else {
        buffer.push(item);
      }
    },
    pull(): Promise<T> {
      const item = buffer.shift();
      if (item !== undefined) return Promise.resolve(item);
      return new Promise<T>((resolve) => waiters.push(resolve));
    },
  };
}

// --- Relay adapters ---

/** Convert onMessage-based RelayChannel to Promise-based NoiseTransport. */
export function relayToNoiseTransport(channel: RelayChannel): NoiseTransport {
  const queue = createAsyncQueue<Uint8Array>();
  channel.onMessage((data) => queue.push(data));

  return {
    send(data: Uint8Array): void {
      channel.send(data);
    },
    receive(): Promise<Uint8Array> {
      return queue.pull();
    },
  };
}

/** Wrap RelayChannel as ChannelTransport (adds missing onError and isOpen). */
export function relayToChannelTransport(channel: RelayChannel): ChannelTransport {
  let open = true;
  const errorHandlers: Array<(err: Error) => void> = [];

  channel.onClose(() => { open = false; });

  return {
    send(data: Uint8Array): void { channel.send(data); },
    onMessage(handler: (data: Uint8Array) => void): void { channel.onMessage(handler); },
    onClose(handler: (reason: string) => void): void { channel.onClose(handler); },
    onError(handler: (err: Error) => void): void { errorHandlers.push(handler); },
    close(): void { open = false; channel.close(); },
    get isOpen(): boolean { return open; },
  };
}

// --- UDP adapters ---

interface UdpSocket {
  send(data: Uint8Array, port: number, address: string, cb?: (err: Error | null) => void): void;
  on(event: "message", handler: (msg: Buffer) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  close(): void;
}

/** Wrap a dgram socket as NoiseTransport. */
export function udpToNoiseTransport(
  socket: UdpSocket,
  remoteAddress: string,
  remotePort: number,
): NoiseTransport {
  const queue = createAsyncQueue<Uint8Array>();
  socket.on("message", (msg: Buffer) => queue.push(new Uint8Array(msg)));

  return {
    send(data: Uint8Array): void {
      socket.send(data, remotePort, remoteAddress);
    },
    receive(): Promise<Uint8Array> {
      return queue.pull();
    },
  };
}

/** Wrap a dgram socket as ChannelTransport. */
export function udpToChannelTransport(
  socket: UdpSocket,
  remoteAddress: string,
  remotePort: number,
): ChannelTransport {
  let open = true;
  const messageHandlers: Array<(data: Uint8Array) => void> = [];
  const closeHandlers: Array<(reason: string) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  socket.on("message", (msg: Buffer) => {
    const data = new Uint8Array(msg);
    for (const h of messageHandlers) h(data);
  });

  socket.on("close", () => {
    open = false;
    for (const h of closeHandlers) h("socket closed");
  });

  socket.on("error", (err: Error) => {
    for (const h of errorHandlers) h(err);
  });

  return {
    send(data: Uint8Array): void { socket.send(data, remotePort, remoteAddress); },
    onMessage(handler: (data: Uint8Array) => void): void { messageHandlers.push(handler); },
    onClose(handler: (reason: string) => void): void { closeHandlers.push(handler); },
    onError(handler: (err: Error) => void): void { errorHandlers.push(handler); },
    close(): void { open = false; socket.close(); },
    get isOpen(): boolean { return open; },
  };
}
