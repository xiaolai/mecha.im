import { type BotName, DEFAULTS, ChatRequestError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { resolveBotEndpoint } from "./helpers.js";

/** Options for sending a chat message to a bot. */
export interface ChatOpts {
  message: string;
  sessionId?: string;
}

/** A parsed SSE event from the bot's chat stream. */
export interface ChatEvent {
  type: "text" | "done";
  content?: string;
  sessionId?: string;
}

/**
 * Sends a chat message to a bot and returns an async iterator of SSE events.
 */
export async function botChat(
  pm: ProcessManager,
  name: BotName,
  opts: ChatOpts,
  signal?: AbortSignal,
): Promise<AsyncIterable<ChatEvent>> {
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
    try { body = await response.json() as Record<string, unknown>; } catch { /* empty fallback */ }
    throw new ChatRequestError(
      response.status,
      (body as { error?: string }).error ?? `Chat request failed: ${response.status}`,
    );
  }

  /* v8 ignore start -- response.body is always present with real fetch */
  if (!response.body) {
    throw new ChatRequestError(response.status, "No response body");
  }
  /* v8 ignore stop */

  return parseSSEStream(response.body);
}

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /* v8 ignore start -- defensive: prevents OOM on pathological stream without newlines */
      if (buffer.length > DEFAULTS.MAX_TRANSCRIPT_BYTES) {
        throw new Error("SSE buffer exceeded maximum size");
      }
      /* v8 ignore stop */

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? /* v8 ignore start */ "" /* v8 ignore stop */;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            yield JSON.parse(data) as ChatEvent;
          } catch {
            // skip malformed JSON
          }
        }
      }
    }

    // Flush decoder for any final multibyte character fragment
    buffer += decoder.decode();

    // Flush remaining buffer after stream ends (no trailing newline)
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6);
      try {
        yield JSON.parse(data) as ChatEvent;
      /* v8 ignore start -- skip malformed final chunk */
      } catch {
        // skip malformed JSON
      }
      /* v8 ignore stop */
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
