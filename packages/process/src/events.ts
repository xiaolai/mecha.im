import { type BotName, createLogger } from "@mecha/core";

const log = createLogger("mecha:process");

/** Lifecycle events emitted by ProcessManager */
export type ProcessEvent =
  | { type: "spawned"; name: BotName; pid: number; port: number }
  | { type: "stopped"; name: BotName; exitCode?: number; signal?: string }
  | { type: "error"; name: BotName; error: string }
  | { type: "warning"; name: BotName; message: string };

export type ProcessEventHandler = (event: ProcessEvent) => void;

/**
 * Simple typed event emitter for process lifecycle events.
 * Returns an unsubscribe function from subscribe().
 */
export class ProcessEventEmitter {
  private handlers = new Set<ProcessEventHandler>();

  subscribe(handler: ProcessEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: ProcessEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        // Isolate handler failures so one bad handler doesn't break others.
        // Log to stderr so failures are not completely invisible.
        log.error("Event handler threw", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}
