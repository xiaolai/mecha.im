import { type NextRequest } from "next/server";
import { generateTotp } from "@mecha/core";
import { getRuntimeAccess } from "@mecha/service";
import { getProcessManager } from "@/lib/process";
import { getOtpSecret } from "@/lib/auth";
import { withStreamAuth } from "@/lib/api-auth";

export const POST = withStreamAuth(async (
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
): Promise<Response> => {
  const { id } = await params;
  const pm = getProcessManager();

  // Get runtime URL and auth token from ProcessManager
  let runtimeUrl: string;
  let authToken: string | undefined;
  try {
    const access = await getRuntimeAccess(pm, id);
    runtimeUrl = access.url;
    authToken = access.token;
  } catch (err) {
    const message = err instanceof Error && err.message.includes("not found") ? "Not found" : "Failed to access runtime";
    const status = message === "Not found" ? 404 : 502;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Forward the request body to runtime
  // Runtime expects { message: string }
  // Accept both { message: string } (preferred) and legacy { messages: [...] }
  let body: { message?: string; messages?: Array<{ role: string; content: string }> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  let message: string;
  if (typeof body.message === "string") {
    message = body.message;
  } else {
    // Legacy: extract the last user message from the messages array
    const messages = body.messages ?? [];
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    message = lastUserMsg?.content ?? "";
  }

  // Build auth headers for runtime request
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  } else {
    // Fallback: use TOTP from dashboard env
    const otpSecret = getOtpSecret();
    if (otpSecret) {
      headers["x-mecha-otp"] = generateTotp(otpSecret);
    }
  }

  const runtimeRes = await fetch(`${runtimeUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
    signal: request.signal,
  });

  if (!runtimeRes.ok) {
    return new Response(runtimeRes.body, {
      status: runtimeRes.status,
      headers: { "Content-Type": runtimeRes.headers.get("Content-Type") ?? "application/json" },
    });
  }

  // Stream the SSE response back to client
  return new Response(runtimeRes.body, {
    headers: {
      "Content-Type": runtimeRes.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
