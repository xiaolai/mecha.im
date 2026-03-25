import { type BotName, ChatRequestError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { resolveBotEndpoint } from "./helpers.js";

/** Chat-specific timeout aligned with runtime CHAT_TIMEOUT_MS (10 minutes). */
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;

/** Options for sending a chat message to a bot. */
export interface ChatOpts {
  message: string;
  sessionId?: string;
}

/** Response from a bot chat request. */
export interface ChatResult {
  response: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

/**
 * Sends a chat message to a bot and returns the response.
 */
export async function botChat(
  pm: ProcessManager,
  name: BotName,
  opts: ChatOpts,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const info = resolveBotEndpoint(pm, name);

  const url = `http://127.0.0.1:${info.port}/api/chat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${info.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(opts),
      signal: signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (err) {
    // Wrap network/abort errors with bot context
    const msg = err instanceof Error ? err.message : String(err);
    throw new ChatRequestError(0, `Chat request to bot "${name}" failed: ${msg}`);
  }

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    /* v8 ignore start -- error body parsing fallback */
    try { body = await response.json() as Record<string, unknown>; } catch { /* empty fallback */ }
    /* v8 ignore stop */
    throw new ChatRequestError(
      response.status,
      (body as { error?: string }).error ?? `Chat request failed: ${response.status}`,
    );
  }

  const result = await response.json() as Record<string, unknown>;
  // Validate required fields before returning
  if (
    typeof result.response !== "string" ||
    typeof result.sessionId !== "string" ||
    typeof result.durationMs !== "number" ||
    typeof result.costUsd !== "number"
  ) {
    throw new ChatRequestError(502, "Invalid chat response from bot — missing required fields");
  }

  return result as unknown as ChatResult;
}
