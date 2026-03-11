import { createLogger } from "@mecha/core";

const log = createLogger("mecha:activity");

/** Activity states for bot visualization. */
export type ActivityState =
  | "idle"
  | "thinking"
  | "tool_use"
  | "responding"
  | "error";

/** Real-time activity event emitted during SDK queries. */
export interface ActivityEvent {
  type: "activity";
  name: string;
  activity: ActivityState;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

export type ActivityEventHandler = (event: ActivityEvent) => void;

/**
 * Typed event emitter for bot activity events.
 * Mirrors ProcessEventEmitter pattern from packages/process/src/events.ts.
 * Deduplicates consecutive identical states per queryId.
 */
export class ActivityEmitter {
  private handlers = new Set<ActivityEventHandler>();
  private lastState = new Map<string, ActivityState>();

  subscribe(handler: ActivityEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  emit(event: ActivityEvent): void {
    // Deduplicate consecutive identical states per bot+queryId
    const key = `${event.name}:${event.queryId ?? "__default__"}`;
    if (this.lastState.get(key) === event.activity && event.activity !== "idle") {
      return;
    }
    this.lastState.set(key, event.activity);

    // Clean up finished queries
    if (event.activity === "idle" || event.activity === "error") {
      this.lastState.delete(key);
    }

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error("Activity handler threw", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}
