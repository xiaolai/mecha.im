/**
 * Session history: fetch session detail from the API and convert messages
 * to the ThreadMessageLike format expected by assistant-ui's useLocalRuntime.
 *
 * The API now returns ParsedSession with rich content blocks (ContentBlock[]).
 */

import type { ContentBlock, ParsedMessage, ParsedSession } from "@mecha/core";

/**
 * Shape expected by assistant-ui useLocalRuntime's `initialMessages` option.
 * Subset of ThreadMessageLike — we produce text content with a computed `textContent`.
 */
export interface InitialMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt?: Date | undefined;
}

/** Extract plain text from rich ContentBlock[]. */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Convert backend parsed messages to the format assistant-ui expects.
 * Extracts text from ContentBlock[] for display.
 */
export function convertSessionMessages(messages: ParsedMessage[]): InitialMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: extractText(m.content),
    createdAt: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
  }));
}

/**
 * Fetch a session's message history from the dashboard API.
 * Returns converted messages ready to pass as `initialMessages` to useLocalRuntime.
 */
export async function fetchSessionHistory(
  mechaId: string,
  sessionId: string,
  node?: string,
): Promise<InitialMessage[]> {
  try {
    const nodeParam = node && node !== "local"
      ? `?node=${encodeURIComponent(node)}`
      : "";
    const res = await fetch(
      `/api/mechas/${mechaId}/sessions/${sessionId}${nodeParam}`,
    );
    if (!res.ok) return [];
    const detail = (await res.json()) as ParsedSession;
    return convertSessionMessages(detail.messages ?? []);
  } catch {
    return [];
  }
}
