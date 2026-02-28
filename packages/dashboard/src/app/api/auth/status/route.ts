import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOtpSecret } from "../../../../lib/totp.js";
import { deriveSessionKey, verifySessionToken, SESSION_COOKIE } from "../../../../lib/session.js";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = getOtpSecret();
  if (!secret) {
    // No TOTP configured — no auth required
    return NextResponse.json({ authenticated: true, authRequired: false });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const key = deriveSessionKey(secret);
  const result = verifySessionToken(key, token);

  return NextResponse.json({ authenticated: result.valid });
}
