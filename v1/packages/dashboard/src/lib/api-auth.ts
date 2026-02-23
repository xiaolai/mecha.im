import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled, getSessionFromCookies, validateSession } from "./auth";

/** Returns true if authenticated, false otherwise */
export async function checkAuth(): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const sessionId = await getSessionFromCookies();
  return !!sessionId && validateSession(sessionId);
}

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse> | NextResponse;

export function withAuth(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(request, context);
  };
}

type StreamRouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

/** Wrap an SSE/streaming route handler with the same auth check as withAuth.
 *  Returns a plain Response (not NextResponse) to support streaming bodies. */
export function withStreamAuth(handler: StreamRouteHandler): StreamRouteHandler {
  return async (request, context) => {
    if (!(await checkAuth())) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(request, context);
  };
}
