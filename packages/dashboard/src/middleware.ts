import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/** Block DNS rebinding attacks by rejecting requests from non-localhost hosts. */
export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host")?.split(":")[0] ?? "";
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json(
      { error: "Forbidden: non-localhost access" },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
