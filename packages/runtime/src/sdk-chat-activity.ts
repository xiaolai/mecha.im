import type { ActivityEmitter } from "./activity.js";
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:sdk-chat-activity");

/** Context for activity emission during a query. */
export interface ActivityContext {
  name: string;
  queryId: string;
  sessionId?: string;
}

/**
 * Map an SDK event to an activity emission.
 * Extracted from sdkChat for testability — SDK events are opaque objects
 * with a `type` discriminant field.
 */
export function emitActivityFromEvent(
  emitter: ActivityEmitter,
  ctx: ActivityContext,
  event: Record<string, unknown>,
): void {
  const now = new Date().toISOString();
  const base = { type: "activity" as const, name: ctx.name, queryId: ctx.queryId, sessionId: ctx.sessionId, timestamp: now };

  switch (event.type) {
    case "system":
      emitter.emit({ ...base, activity: "thinking" });
      break;
    case "assistant":
    case "stream_event":
      emitter.emit({ ...base, activity: "responding" });
      break;
    case "tool_use_summary":
    case "tool_progress":
      emitter.emit({
        ...base,
        activity: "tool_use",
        toolName: typeof event.tool_name === "string" ? event.tool_name : undefined,
      });
      break;
    case "result":
      if (event.subtype === "success") {
        emitter.emit({ ...base, activity: "idle" });
      } else {
        emitter.emit({ ...base, activity: "error" });
      }
      break;
    default:
      log.debug("Unknown SDK event type", { type: event.type });
      break;
  }
}
