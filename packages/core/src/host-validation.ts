import { isIP } from "node:net";

/**
 * Private/reserved IPv4 ranges as start–end numeric pairs.
 */
const PRIVATE_IPV4_RANGES: ReadonlyArray<{ start: number; end: number }> = [
  { start: 0x7F000000, end: 0x7FFFFFFF },    // 127.0.0.0/8 loopback
  { start: 0x0A000000, end: 0x0AFFFFFF },     // 10.0.0.0/8
  { start: 0xAC100000, end: 0xAC1FFFFF },     // 172.16.0.0/12
  { start: 0xC0A80000, end: 0xC0A8FFFF },     // 192.168.0.0/16
  { start: 0xA9FE0000, end: 0xA9FEFFFF },     // 169.254.0.0/16 link-local
  { start: 0x00000000, end: 0x00FFFFFF },      // 0.0.0.0/8
];

function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".");
  return ((+parts[0]! << 24) | (+parts[1]! << 16) | (+parts[2]! << 8) | +parts[3]!) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNumber(ip);
  return PRIVATE_IPV4_RANGES.some((r) => num >= r.start && num <= r.end);
}

/** Extract embedded IPv4 from IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:XXXX:XXXX hex form) */
function extractMappedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // Dotted form: ::ffff:127.0.0.1
  const dotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1]!;
  // Hex form: ::ffff:7f00:1 or ::ffff:7f00:0001
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Check IPv4-mapped IPv6 addresses (::ffff:127.0.0.1)
  const mapped = extractMappedIPv4(normalized);
  if (mapped) return isPrivateIPv4(mapped);

  return normalized === "::1"             // loopback
    || normalized === "::"                // unspecified
    || /^fe[89ab][0-9a-f]:/.test(normalized) // link-local fe80::/10
    || normalized.startsWith("fc")        // unique local fc00::/7
    || normalized.startsWith("fd");       // unique local fd00::/8
}

/**
 * Canonicalize a host string before validation.
 * Strips brackets from IPv6 literals, lowercases, removes trailing dots.
 */
function canonicalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  // Strip bracketed IPv6 (e.g. [::1])
  if (h.startsWith("[") && h.endsWith("]")) {
    h = h.slice(1, -1);
  }
  // Remove trailing dot from hostnames (e.g. localhost.)
  if (h.endsWith(".") && !h.includes(":")) {
    h = h.slice(0, -1);
  }
  return h;
}

/**
 * Returns true if the host looks like a private/loopback address.
 * Only validates literal IPs. Hostnames that *resolve* to private IPs
 * are not caught here — DNS resolution is out of scope for a sync check.
 */
export function isPrivateHost(host: string): boolean {
  const canonical = canonicalizeHost(host);
  if (canonical === "localhost") return true;

  if (isIP(canonical) === 4) return isPrivateIPv4(canonical);
  if (isIP(canonical) === 6) return isPrivateIPv6(canonical);

  // Detect numeric IPv4 forms (decimal, hex, octal) that bypass isIP()
  // e.g. 2130706433, 0x7f000001, 0177.0.0.1 — URL parsing normalizes these
  try {
    const parsed = new URL(`http://${canonical}`);
    const resolvedHost = parsed.hostname;
    /* v8 ignore start -- numeric IPv4 detection: requires non-standard IP forms like 0x7f000001 */
    if (resolvedHost !== canonical && isIP(resolvedHost) === 4) {
      return isPrivateIPv4(resolvedHost);
    }
    /* v8 ignore stop */
  } catch {
    // Invalid host — not a numeric form
  }

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
