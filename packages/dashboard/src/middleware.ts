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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

/** Block DNS rebinding + CSRF attacks. Enforce session auth when TOTP is configured. */
export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const networkMode = process.env.MECHA_NETWORK_MODE === "true";
  const otpConfigured = !!process.env.MECHA_OTP;

  /* v8 ignore start -- host header always present in NextRequest */
  const rawHost = request.headers.get("host") ?? "";
  /* v8 ignore stop */
  const host = extractHost(rawHost);

  // DNS rebinding check — skip in network mode (TOTP is the trust boundary)
  if (!networkMode && !ALLOWED_HOSTS.has(host)) {
    return NextResponse.json(
      { error: "Forbidden: non-localhost access" },
      { status: 403 },
    );
  }

  // CSRF: require same-origin for state-changing requests
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        const originHost = new URL(origin).hostname;
        // In network mode, allow any origin matching the Host header
        const allowedOrigins = networkMode
          ? new Set([...ALLOWED_HOSTS, host])
          : ALLOWED_HOSTS;
        if (!allowedOrigins.has(originHost)) {
          return NextResponse.json(
            { error: "Forbidden: cross-origin request" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Forbidden: invalid origin" },
          { status: 403 },
        );
      }
    }
  }

  // Session auth — only when TOTP is configured
  if (otpConfigured && !isPublicPath(pathname)) {
    const cookie = request.cookies.get("mecha-session");
    if (!cookie?.value) {
      // API routes get 401, page routes get redirect
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Cookie exists — signature verification happens at the API route level
    // Middleware only checks presence (verifySessionToken needs the derived key from singleton)
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
