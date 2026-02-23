import type { ProcessManager } from "@mecha/process";
import { mechaSessionCreate, mechaSessionMessage } from "@mecha/service";
import type { ChannelStore } from "../db/store.js";
import type { ChannelAdapter, InboundMessage } from "../adapters/types.js";

export interface GatewayDeps {
  store: ChannelStore;
  adapters: Map<string, ChannelAdapter>;
  pm: ProcessManager;
}

/** Extract final response text from SSE data events.
 *  The mecha runtime emits multiple event types but only "result" carries the final text.
 *  For non-mecha SSE streams, falls back to common streaming shapes. */
export function extractText(data: Record<string, unknown>): string | null {
  // Mecha runtime "result" event: { type: "result", subtype: "success", result: "final text" }
  // This is the authoritative final response — return it and signal "done".
  if (data.type === "result" && typeof data.result === "string") return data.result;
  // Mecha runtime "session", "system", "assistant" events carry metadata, not user-facing text.
  if (data.type === "session" || data.type === "system" || data.type === "assistant") return null;
  // Generic streaming shapes for non-mecha SSE sources:
  if (typeof data.text === "string") return data.text;
  if (typeof data.content === "string") return data.content;
  if (data.delta && typeof data.delta === "object") {
    const delta = data.delta as Record<string, unknown>;
    if (typeof delta.text === "string") return delta.text;
  }
  return null;
}

function parseSSELines(lines: string[], accumulated: string): string {
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === "[DONE]") continue;
    try {
      const data = JSON.parse(jsonStr);
      const text = extractText(data);
      if (text) accumulated += text;
    } catch {
      // Skip malformed JSON lines
    }
  }
  return accumulated;
}

/** Parse SSE stream response and extract accumulated text. */
export async function consumeSSEResponse(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    // Keep last partial line in buffer
    /* v8 ignore start */
    buffer = lines.pop() ?? "";
    /* v8 ignore stop */

    accumulated = parseSSELines(lines, accumulated);
  }

  // Flush any remaining bytes from the decoder (trailing multibyte chars)
  buffer += decoder.decode();

  // Process any remaining data in buffer after stream ends
  if (buffer.trim()) {
    accumulated = parseSSELines([buffer], accumulated);
  }

  return accumulated;
}

// Simple in-memory lock to prevent concurrent session creation for the same chat
const sessionLocks = new Map<string, Promise<void>>();

/** Handle an inbound message from a channel adapter. */
export async function handleInbound(
  deps: GatewayDeps,
  channelId: string,
  msg: InboundMessage,
): Promise<void> {
  const { store, adapters } = deps;
  const adapter = adapters.get(channelId);
  if (!adapter) return;

  const link = store.getLink(channelId, msg.chatId);

  if (!link) {
    await adapter.sendText(
      msg.chatId,
      `Your chat ID is: ${msg.chatId}\n\nThis chat is not linked to a mecha. Use:\n  mecha channel link <channelId> ${msg.chatId} <mechaId>`,
    );
    return;
  }

  // Serialize per-chat to prevent duplicate session creation
  const lockKey = `${channelId}:${msg.chatId}`;
  const prev = sessionLocks.get(lockKey) ?? Promise.resolve();
  const current = prev.then(() => processMessage(deps, adapter, channelId, msg, link));
  /* v8 ignore start — cleanup runs async after await completes */
  sessionLocks.set(lockKey, current.catch(() => {}).then(() => {
    if (sessionLocks.get(lockKey) === current) sessionLocks.delete(lockKey);
  }));
  /* v8 ignore stop */
  await current;
}

async function ensureSession(
  store: ChannelStore,
  pm: ProcessManager,
  channelId: string,
  msg: InboundMessage,
  link: { mecha_id: string; session_id: string | null },
): Promise<string> {
  let sessionId = link.session_id;
  if (!sessionId) {
    // Re-read link in case another message already created the session
    const freshLink = store.getLink(channelId, msg.chatId);
    sessionId = freshLink?.session_id ?? null;
  }
  if (!sessionId) {
    const session = await mechaSessionCreate(pm, {
      id: link.mecha_id,
      title: `telegram-${msg.chatId}`,
    });
    const result = session as Record<string, unknown>;
    /* v8 ignore start — defensive guard: runtime API always returns sessionId */
    if (typeof result.sessionId !== "string") {
      throw new Error("Session creation did not return a sessionId");
    }
    /* v8 ignore stop */
    sessionId = result.sessionId;
    store.updateSessionId(channelId, msg.chatId, sessionId);
  }
  return sessionId;
}

async function processMessage(
  deps: GatewayDeps,
  adapter: ChannelAdapter,
  channelId: string,
  msg: InboundMessage,
  link: { mecha_id: string; session_id: string | null },
): Promise<void> {
  const { store, pm } = deps;
  try {
    const sessionId = await ensureSession(store, pm, channelId, msg, link);

    // Show typing indicator while processing (Telegram's expires after ~5s)
    await adapter.sendTyping(msg.chatId);
    /* v8 ignore start — interval callback not reachable in sync tests */
    const typingInterval = setInterval(() => {
      adapter.sendTyping(msg.chatId).catch(() => {});
    }, 4000);
    /* v8 ignore stop */

    try {
      const res = await mechaSessionMessage(pm, {
        id: link.mecha_id,
        sessionId,
        message: msg.text,
      });

      const responseText = await consumeSSEResponse(res);
      if (responseText) {
        await adapter.sendText(msg.chatId, responseText);
      }
    } finally {
      clearInterval(typingInterval);
    }
  } catch {
    // Don't expose internal error details to Telegram users
    await adapter.sendText(msg.chatId, "Sorry, something went wrong. Please try again later.");
  }
}
