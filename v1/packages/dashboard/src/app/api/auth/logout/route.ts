import { NextResponse } from "next/server";
import { getSessionFromCookies, deleteSession, clearSessionCookie } from "@/lib/auth";

export async function POST(): Promise<NextResponse> {
  const sessionId = await getSessionFromCookies();
  if (sessionId) {
    deleteSession(sessionId);
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
