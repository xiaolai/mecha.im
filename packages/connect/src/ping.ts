import { ConnectError } from "@mecha/core";
import type { NodeName } from "@mecha/core";
import type { SecureChannel, PingResult } from "./types.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Send a ping over a SecureChannel and measure RTT. */
export async function pingPeer(
  peer: NodeName,
  channel: SecureChannel,
): Promise<PingResult> {
  const nonce = crypto.randomUUID();
  const start = performance.now();
  const pingData = textEncoder.encode(JSON.stringify({ type: "ping", nonce }));
  channel.send(pingData);

  // Wait for pong response to measure actual RTT
  const latencyMs = await new Promise<number>((resolve, reject) => {
    /* v8 ignore start -- ping timeout requires 5s wait */
    const timeout = setTimeout(() => {
      channel.offMessage(handler);
      reject(new ConnectError(`Ping timeout for "${peer}"`));
    }, 5_000);
    /* v8 ignore stop */

    /* v8 ignore start -- pong handler: non-matching nonce and parse errors are defensive */
    function handler(data: Uint8Array): void {
      try {
        const msg = JSON.parse(textDecoder.decode(data)) as { type?: string; nonce?: string };
        if (msg.type === "pong" && msg.nonce === nonce) {
          clearTimeout(timeout);
          channel.offMessage(handler);
          resolve(Math.round(performance.now() - start));
        }
      } catch { /* not a JSON ping response, ignore */ }
    }
    /* v8 ignore stop */

    // Fail fast on channel close
    const closeHandler = (): void => {
      clearTimeout(timeout);
      channel.offMessage(handler);
      reject(new ConnectError(`Channel closed during ping to "${peer}"`));
    };

    channel.onMessage(handler);
    channel.onClose(closeHandler);
  });

  return {
    peer,
    latencyMs,
    connectionType: channel.type,
  };
}
