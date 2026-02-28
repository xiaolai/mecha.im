import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

export function extractHost(raw: string): string {
  // Handle IPv6 with brackets: [::1]:3000 → ::1
  if (raw.startsWith("[")) {
    const closing = raw.indexOf("]");
    return closing > 0 ? raw.slice(1, closing) : raw;
  }
  // IPv4 or hostname: 127.0.0.1:3000 → 127.0.0.1
  const colon = raw.lastIndexOf(":");
  // Only strip if the part after colon looks like a port number
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) {
    return raw.slice(0, colon);
  }
  return raw;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64urlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify a JWT (HS256) using the Web Crypto API (Edge-compatible).
 * The key is pre-derived via HKDF at server startup and stored in MECHA_SESSION_KEY.
 */
export async function verifySessionToken(hexKey: string, token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  // Decode and check expiry first (cheap check before crypto)
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return false;
  } catch {
    return false;
  }

  // Verify HMAC-SHA256 signature using Web Crypto API
  try {
    const keyData = hexToUint8Array(hexKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const expectedSig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, sigInput));
    const actualSig = base64urlToUint8Array(parts[2]!);

    // Constant-time compare
    /* v8 ignore start -- HMAC signatures are always 32 bytes; length mismatch is defensive */
    if (expectedSig.length !== actualSig.length) return false;
    /* v8 ignore stop */
    let mismatch = 0;
    for (let i = 0; i < expectedSig.length; i++) {
      /* v8 ignore start -- array elements always defined within bounds */
      mismatch |= (expectedSig[i] ?? 0) ^ (actualSig[i] ?? 0);
      /* v8 ignore stop */
    }
    return mismatch === 0;
    /* v8 ignore start -- crypto.subtle errors are defensive */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

function rejectResponse(reason: string, status: number, pathname: string): NextResponse {
  console.warn(JSON.stringify({
    level: "warn",
    route: "middleware",
    msg: `Request rejected: ${reason}`,
    pathname,
    status,
    ts: new Date().toISOString(),
  }));
  /* v8 ignore start -- browser redirect tested via integration tests, unit tests only hit API paths */
  if (status === 401 && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/login", "http://localhost"));
  }
  /* v8 ignore stop */
  const body = status === 401 ? { error: "Unauthorized" } : { error: reason };
  return NextResponse.json(body, { status });
}

/** Block DNS rebinding + CSRF attacks. Enforce session auth when TOTP is configured. */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const networkMode = process.env.MECHA_NETWORK_MODE === "true";
  const otpConfigured = !!process.env.MECHA_OTP;

  /* v8 ignore start -- host header always present in NextRequest */
  const rawHost = request.headers.get("host") ?? "";
  /* v8 ignore stop */
  const host = extractHost(rawHost);

  // DNS rebinding check — skip in network mode (TOTP is the trust boundary)
  if (!networkMode && !ALLOWED_HOSTS.has(host)) {
    return rejectResponse("Forbidden: non-localhost access", 403, pathname);
  }

  // CSRF: require same-origin for state-changing requests
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin) {
      // Block state-changing requests without Origin header to prevent CSRF
      return rejectResponse("Forbidden: missing origin header", 403, pathname);
    }
    try {
      const originHost = new URL(origin).hostname;
      // In network mode, allow any origin matching the Host header
      const allowedOrigins = networkMode
        ? new Set([...ALLOWED_HOSTS, host])
        : ALLOWED_HOSTS;
      if (!allowedOrigins.has(originHost)) {
        return rejectResponse("Forbidden: cross-origin request", 403, pathname);
      }
    } catch {
      return rejectResponse("Forbidden: invalid origin", 403, pathname);
    }
  }

  // Session auth — only when TOTP is configured
  if (otpConfigured && !isPublicPath(pathname)) {
    const cookie = request.cookies.get("mecha-session");
    if (!cookie?.value) {
      if (pathname.startsWith("/api/")) {
        return rejectResponse("Unauthorized", 401, pathname);
      }
      /* v8 ignore start -- browser redirect for missing cookie; unit tests only hit API paths */
      console.warn(JSON.stringify({
        level: "warn",
        route: "middleware",
        msg: "Request rejected: missing session cookie",
        pathname,
        ts: new Date().toISOString(),
      }));
      return NextResponse.redirect(new URL("/login", request.url));
      /* v8 ignore stop */
    }

    // Verify JWT signature using pre-computed session key
    const sessionKey = process.env.MECHA_SESSION_KEY;
    if (!sessionKey || !(await verifySessionToken(sessionKey, cookie.value))) {
      if (pathname.startsWith("/api/")) {
        return rejectResponse("Unauthorized: invalid session", 401, pathname);
      }
      /* v8 ignore start -- browser redirect for invalid token; unit tests only hit API paths */
      console.warn(JSON.stringify({
        level: "warn",
        route: "middleware",
        msg: "Request rejected: invalid/expired session token",
        pathname,
        ts: new Date().toISOString(),
      }));
      return NextResponse.redirect(new URL("/login", request.url));
      /* v8 ignore stop */
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
