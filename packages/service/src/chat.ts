import { type BotName, DEFAULTS, ChatRequestError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { resolveBotEndpoint } from "./helpers.js";

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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${info.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(opts),
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(DEFAULTS.FORWARD_TIMEOUT_MS), signal])
      : AbortSignal.timeout(DEFAULTS.FORWARD_TIMEOUT_MS),
  });

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

  return await response.json() as ChatResult;
}
