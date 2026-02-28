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

/** Block DNS rebinding + CSRF attacks on localhost API. */
export function middleware(request: NextRequest): NextResponse {
  /* v8 ignore start -- host header always present in NextRequest */
  const rawHost = request.headers.get("host") ?? "";
  /* v8 ignore stop */
  const host = extractHost(rawHost);
  if (!ALLOWED_HOSTS.has(host)) {
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
        if (!ALLOWED_HOSTS.has(originHost)) {
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

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
