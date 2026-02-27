/**
 * HTTP forwarding utility for inter-CASA communication.
 * Isolated from casa-config.ts to keep config reading pure (no I/O beyond filesystem).
 */
import { DEFAULTS } from "./constants.js";
import { ForwardingError } from "./errors.js";

export interface ForwardResult {
  text: string;
  sessionId?: string;
}

/**
 * Forward a query message to a CASA via HTTP.
 * Shared by service/router and runtime/mesh-tools.
 */
export async function forwardQueryToCasa(
  port: number,
  token: string,
  message: string,
  sessionId?: string,
  requestId?: string,
): Promise<ForwardResult> {
  const url = `http://127.0.0.1:${port}/api/chat`;
  const body: Record<string, string> = { message };
  if (sessionId !== undefined) body.sessionId = sessionId;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  /* v8 ignore start -- requestId is passed by service/router; tested in integration */
  if (requestId) headers["x-request-id"] = requestId;
  /* v8 ignore stop */

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULTS.FORWARD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ForwardingError(response.status, { cause: new Error(`${response.statusText} from ${url}`) });
  }

  /* v8 ignore start -- content-type parsing branches */
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as Record<string, unknown>;
    const text = typeof data.response === "string" ? data.response : JSON.stringify(data);
    const returnedSessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
    return { text, sessionId: returnedSessionId };
  }
  return { text: await response.text() };
  /* v8 ignore stop */
}
