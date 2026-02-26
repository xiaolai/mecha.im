import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { DEFAULTS } from "@mecha/core";
import type { StunResult } from "./types.js";

// STUN message types (RFC 5389)
const BINDING_REQUEST = 0x0001;
const BINDING_RESPONSE = 0x0101;
const MAGIC_COOKIE = 0x2112a442;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_MAPPED_ADDRESS = 0x0001;
const STUN_HEADER_SIZE = 20;

/** Build a STUN Binding Request (20 bytes: type + length + magic cookie + transaction ID). */
export function buildBindingRequest(): { buffer: Buffer; transactionId: Buffer } {
  const transactionId = randomBytes(12);
  const buf = Buffer.alloc(STUN_HEADER_SIZE);
  buf.writeUInt16BE(BINDING_REQUEST, 0);     // Message Type
  buf.writeUInt16BE(0, 2);                    // Message Length (no attributes)
  buf.writeUInt32BE(MAGIC_COOKIE, 4);         // Magic Cookie
  transactionId.copy(buf, 8);                 // Transaction ID
  return { buffer: buf, transactionId };
}

/** Parse a STUN Binding Response to extract the mapped address. */
export function parseBindingResponse(
  data: Buffer,
  transactionId: Buffer,
): StunResult | undefined {
  if (data.length < STUN_HEADER_SIZE) return undefined;

  const msgType = data.readUInt16BE(0);
  if (msgType !== BINDING_RESPONSE) return undefined;

  const cookie = data.readUInt32BE(4);
  if (cookie !== MAGIC_COOKIE) return undefined;

  // Verify transaction ID
  if (!data.subarray(8, 20).equals(transactionId)) return undefined;

  const msgLen = data.readUInt16BE(2);
  let offset = STUN_HEADER_SIZE;
  const end = Math.min(STUN_HEADER_SIZE + msgLen, data.length);

  while (offset + 4 <= end) {
    const attrType = data.readUInt16BE(offset);
    const attrLen = data.readUInt16BE(offset + 2);
    const attrStart = offset + 4;

    /* v8 ignore start -- bounds check for malformed STUN packets */
    if (attrStart + attrLen > data.length) break;
    /* v8 ignore stop */

    if (attrType === ATTR_XOR_MAPPED_ADDRESS && attrLen >= 8) {
      const family = data[attrStart + 1]!;
      if (family === 0x01) {
        // IPv4
        const xPort = data.readUInt16BE(attrStart + 2);
        const port = xPort ^ (MAGIC_COOKIE >>> 16);
        const xIp = data.readUInt32BE(attrStart + 4);
        const ip = xIp ^ MAGIC_COOKIE;
        return {
          ip: `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`,
          port,
        };
      }
    }

    if (attrType === ATTR_MAPPED_ADDRESS && attrLen >= 8) {
      const family = data[attrStart + 1]!;
      if (family === 0x01) {
        const port = data.readUInt16BE(attrStart + 2);
        const ip0 = data[attrStart + 4]!;
        const ip1 = data[attrStart + 5]!;
        const ip2 = data[attrStart + 6]!;
        const ip3 = data[attrStart + 7]!;
        return { ip: `${ip0}.${ip1}.${ip2}.${ip3}`, port };
      }
    }

    // Attributes are padded to 4-byte boundaries
    offset = attrStart + Math.ceil(attrLen / 4) * 4;
  }

  return undefined;
}

/** Parse a STUN server address string like "stun:host:port" or "host:port". */
export function parseStunServer(server: string): { host: string; port: number } {
  const s = server.startsWith("stun:") ? server.slice(5) : server;
  /* v8 ignore start -- IPv6 literal parsing (e.g., [::1]:3478) */
  const ipv6Match = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  if (ipv6Match) {
    const port = ipv6Match[2] ? parseInt(ipv6Match[2], 10) : 3478;
    return { host: ipv6Match[1]!, port: (port >= 1 && port <= 65535) ? port : 3478 };
  }
  /* v8 ignore stop */
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return { host: s, port: 3478 };
  const host = s.slice(0, lastColon);
  const port = parseInt(s.slice(lastColon + 1), 10);
  return { host, port: (Number.isInteger(port) && port >= 1 && port <= 65535) ? port : 3478 };
}

export interface StunDiscoverOpts {
  localPort: number;
  stunServer?: string;
  timeoutMs?: number;
  /** Injected socket factory for testing */
  createUdpSocket?: typeof createSocket;
}

/* v8 ignore start -- requires real UDP sockets for STUN discovery */
/** Discover public IP:port via STUN Binding Request. */
export async function stunDiscover(opts: StunDiscoverOpts): Promise<StunResult> {
  const {
    localPort,
    stunServer = DEFAULTS.STUN_SERVERS[0]!,
    timeoutMs = DEFAULTS.STUN_TIMEOUT_MS,
    createUdpSocket = createSocket,
  } = opts;

  const { host, port } = parseStunServer(stunServer);
  const socket = createUdpSocket("udp4");
  const { buffer, transactionId } = buildBindingRequest();

  return new Promise<StunResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`STUN timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("message", (msg: Buffer) => {
      const result = parseBindingResponse(msg, transactionId);
      if (result) {
        clearTimeout(timer);
        socket.close();
        resolve(result);
      }
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.bind(localPort, () => {
      socket.send(buffer, 0, buffer.length, port, host, (err) => {
        /* v8 ignore start -- send failure triggers socket error handler */
        if (err) {
          clearTimeout(timer);
          socket.close();
          reject(err);
        }
        /* v8 ignore stop */
      });
    });
  });
}
/* v8 ignore stop */
