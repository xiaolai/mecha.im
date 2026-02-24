import type { CasaName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { CasaNotFoundError, CasaNotRunningError } from "@mecha/contracts";

export interface ChatOpts {
  message: string;
  sessionId?: string;
}

export interface ChatEvent {
  type: "text" | "done";
  content?: string;
  sessionId?: string;
}

/**
 * Sends a chat message to a CASA and returns an async iterator of SSE events.
 */
export async function casaChat(
  pm: ProcessManager,
  name: CasaName,
  opts: ChatOpts,
): Promise<AsyncIterable<ChatEvent>> {
  const info = pm.getPortAndToken(name);
  if (!info) {
    const processInfo = pm.get(name);
    if (processInfo) throw new CasaNotRunningError(name);
    throw new CasaNotFoundError(name);
  }

  const url = `http://127.0.0.1:${info.port}/api/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${info.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(opts),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(/* v8 ignore start */ () => ({}) /* v8 ignore stop */);
    throw new Error((body as { error?: string }).error ?? `Chat request failed: ${response.status}`);
  }

  /* v8 ignore next 3 -- response.body is always present with real fetch */
  if (!response.body) {
    throw new Error("No response body");
  }

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
  } finally {
    reader.releaseLock();
  }
}
