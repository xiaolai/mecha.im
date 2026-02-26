import { isIP } from "node:net";

/**
 * Private/reserved IPv4 ranges.
 * Blocks: loopback, link-local, private networks, broadcast.
 */
const PRIVATE_IPV4_RANGES: Array<{ prefix: string; bits: number; start: number; end: number }> = [
  { prefix: "127.", bits: 8, start: 0x7F000000, end: 0x7FFFFFFF },    // 127.0.0.0/8 loopback
  { prefix: "10.", bits: 8, start: 0x0A000000, end: 0x0AFFFFFF },     // 10.0.0.0/8
  { prefix: "172.", bits: 12, start: 0xAC100000, end: 0xAC1FFFFF },   // 172.16.0.0/12
  { prefix: "192.168.", bits: 16, start: 0xC0A80000, end: 0xC0A8FFFF }, // 192.168.0.0/16
  { prefix: "169.254.", bits: 16, start: 0xA9FE0000, end: 0xA9FEFFFF }, // 169.254.0.0/16 link-local
  { prefix: "0.", bits: 8, start: 0x00000000, end: 0x00FFFFFF },      // 0.0.0.0/8
];

function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".");
  return ((+parts[0]! << 24) | (+parts[1]! << 16) | (+parts[2]! << 8) | +parts[3]!) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNumber(ip);
  return PRIVATE_IPV4_RANGES.some((r) => num >= r.start && num <= r.end);
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::1"             // loopback
    || normalized.startsWith("fe80:")     // link-local
    || normalized.startsWith("fc")        // unique local fc00::/7
    || normalized.startsWith("fd");       // unique local fd00::/8
}

/**
 * Returns true if the host looks like a private/loopback address.
 * Only validates literal IPs. Hostnames that *resolve* to private IPs
 * are not caught here — DNS resolution is out of scope for a sync check.
 */
export function isPrivateHost(host: string): boolean {
  if (host === "localhost") return true;

  if (isIP(host) === 4) return isPrivateIPv4(host);
  if (isIP(host) === 6) return isPrivateIPv6(host);

  // Hostname — cannot validate without DNS resolution; allow
  return false;
}

/**
 * Validate a host for outbound agent-to-agent communication.
 * Throws if the host is a private/loopback address (SSRF protection).
 */
export function validateRemoteHost(host: string): void {
  if (isPrivateHost(host)) {
    throw new Error(`Refusing to connect to private/loopback address: ${host}`);
  }
}
