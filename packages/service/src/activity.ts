import { type BotName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { resolveBotEndpoint } from "./helpers.js";

/** Current activity snapshot from a bot. */
export interface ActivitySnapshot {
  name: string;
  activity: string;
  timestamp: string;
}

/**
 * Fetch the current activity snapshot from a bot's /api/events/snapshot endpoint.
 */
export async function botActivitySnapshot(
  pm: ProcessManager,
  name: BotName,
): Promise<ActivitySnapshot> {
  const info = resolveBotEndpoint(pm, name);
  const url = `http://127.0.0.1:${info.port}/api/events/snapshot`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${info.token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch activity: ${response.status}`);
  }
  return await response.json() as ActivitySnapshot;
}

/**
 * Stream activity events from a bot's /api/events SSE endpoint.
 * Yields parsed ActivityEvent objects.
 */
export async function* botActivityStream(
  pm: ProcessManager,
  name: BotName,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const info = resolveBotEndpoint(pm, name);
  const url = `http://127.0.0.1:${info.port}/api/events`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${info.token}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to connect to activity stream: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            // skip malformed data lines
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
