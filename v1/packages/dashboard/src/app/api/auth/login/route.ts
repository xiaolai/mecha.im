import { NextResponse, type NextRequest } from "next/server";
import { verifyTotp } from "@mecha/core";
import { isAuthEnabled, getOtpSecret, createSession, setSessionCookie } from "@/lib/auth";

// Simple global rate limiting for brute-force protection (not per-IP to avoid spoofing)
const MAX_ENTRIES = 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function evictExpiredAttempts(): void {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}

function isRateLimited(ip: string): boolean {
  // Periodically evict to bound memory
  if (attempts.size > MAX_ENTRIES) evictExpiredAttempts();

  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "Auth not enabled" }, { status: 400 });
  }

  // Use x-real-ip (set by trusted reverse proxy) instead of x-forwarded-for (easily spoofable)
  const ip = request.headers.get("x-real-ip") ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: { code?: string };
  try {
    body = await request.json() as { code?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.code;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const secret = getOtpSecret()!;
  if (!verifyTotp(secret, code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const sessionId = createSession();
  await setSessionCookie(sessionId);

  return NextResponse.json({ ok: true });
}
