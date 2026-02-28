import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyTotpCode, getOtpSecret } from "../../../../lib/totp.js";
import { deriveSessionKey, createSessionToken, SESSION_COOKIE } from "../../../../lib/session.js";
import { createLoginLimiter } from "../../../../lib/login-limiter.js";
import { getSessionTtlHours, log } from "../../../../lib/pm-singleton.js";

const limiter = createLoginLimiter();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const route = "/api/auth/login";

  const { allowed, retryAfterMs } = limiter.check();
  if (!allowed) {
    log.warn(route, "Rate limited", { retryAfterMs });
    return NextResponse.json(
      { error: "Too many attempts", retryAfterMs },
      { status: 429 },
    );
  }

  const secret = getOtpSecret();
  if (!secret) {
    log.error(route, "TOTP not configured");
    return NextResponse.json({ error: "TOTP not configured" }, { status: 500 });
  }

  let code: string;
  try {
    const body = await request.json() as { code?: string };
    code = String(body.code ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!verifyTotpCode(secret, code)) {
    limiter.recordFailure();
    log.warn(route, "Invalid TOTP code");
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  limiter.reset();
  const key = deriveSessionKey(secret);
  const ttl = getSessionTtlHours();
  const token = createSessionToken(key, ttl);

  log.info(route, "Login successful");

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: ttl * 3600,
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}
