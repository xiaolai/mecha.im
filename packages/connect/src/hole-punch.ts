import { createSocket, type Socket } from "node:dgram";
import { DEFAULTS } from "@mecha/core";
import type { Candidate, HolePunchResult } from "./types.js";

/* v8 ignore start -- requires real UDP sockets and NAT traversal */

const PUNCH_MAGIC = Buffer.from("MECHA-PUNCH");
const PUNCH_ACK = Buffer.from("MECHA-ACK");
const BURST_INTERVAL_MS = 100;

export interface HolePunchOpts {
  localPort: number;
  remoteCandidates: Candidate[];
  timeoutMs?: number;
  /** Injected socket factory for testing */
  createUdpSocket?: typeof createSocket;
}

/**
 * UDP hole-punching using simultaneous open.
 *
 * Sends UDP packets to all remote candidates at BURST_INTERVAL_MS.
 * First bidirectional exchange = success.
 */
export async function holePunch(opts: HolePunchOpts): Promise<HolePunchResult> {
  const {
    localPort,
    remoteCandidates,
    timeoutMs = DEFAULTS.HOLE_PUNCH_TIMEOUT_MS,
    createUdpSocket = createSocket,
  } = opts;

  if (remoteCandidates.length === 0) {
    return { success: false };
  }

  const socket = createUdpSocket("udp4");

  return new Promise<HolePunchResult>((resolve, reject) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(burstTimer);
        socket.close();
        resolve({ success: false });
      }
    }, timeoutMs);

    socket.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        clearInterval(burstTimer);
        socket.close();
        reject(err);
      }
    });

    socket.on("message", (msg: Buffer, rinfo) => {
      if (resolved) return;

      if (msg.equals(PUNCH_MAGIC)) {
        // Received a punch — send ACK back
        socket.send(PUNCH_ACK, rinfo.port, rinfo.address);
      }

      if (msg.equals(PUNCH_ACK)) {
        // Got an ACK — hole punch succeeded!
        resolved = true;
        clearTimeout(timer);
        clearInterval(burstTimer);
        socket.close();

        const candidateIndex = remoteCandidates.findIndex(
          (c) => c.ip === rinfo.address && c.port === rinfo.port,
        );

        resolve({
          success: true,
          remoteAddress: rinfo.address,
          remotePort: rinfo.port,
          candidateIndex: candidateIndex >= 0 ? candidateIndex : undefined,
        });
      }
    });

    // Send bursts to all candidates
    const sendBurst = (): void => {
      for (const candidate of remoteCandidates) {
        socket.send(PUNCH_MAGIC, candidate.port, candidate.ip);
      }
    };

    socket.bind(localPort, () => {
      sendBurst(); // First burst immediately
    });

    const burstTimer = setInterval(sendBurst, BURST_INTERVAL_MS);
  });
}
/* v8 ignore stop */
