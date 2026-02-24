import type { CasaName } from "@mecha/core";

/** Lifecycle events emitted by ProcessManager */
export type ProcessEvent =
  | { type: "spawned"; name: CasaName; pid: number; port: number }
  | { type: "stopped"; name: CasaName; exitCode?: number }
  | { type: "error"; name: CasaName; error: string };

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
      } catch {
        // Isolate handler failures so one bad handler doesn't break others
      }
    }
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}
