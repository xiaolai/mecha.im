import { createLogger } from "@mecha/core";

const log = createLogger("mecha:activity-aggregator");

/** Activity event from a bot runtime. */
export interface AggregatedActivityEvent {
  type: "activity";
  name: string;
  activity: string;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

type ActivityHandler = (event: AggregatedActivityEvent) => void;

interface BotConnection {
  name: string;
  port: number;
  token: string;
  abortController: AbortController;
}

/**
 * Aggregates SSE activity streams from multiple bot runtimes.
 * Opens one SSE connection per running bot, re-emits events
 * to subscribers (daemon SSE route).
 */
export class ActivityAggregator {
  private handlers = new Set<ActivityHandler>();
  private connections = new Map<string, BotConnection>();

  subscribe(handler: ActivityHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** Inject an event directly (for testing or manual emission). */
  injectEvent(event: AggregatedActivityEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error("Activity handler threw", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** Start consuming SSE from a bot's /api/events endpoint. */
  addBot(name: string, port: number, token: string, opts?: { skipConnect?: boolean }): void {
    // Abort existing connection if any
    this.removeBot(name);

    const ac = new AbortController();
    this.connections.set(name, { name, port, token, abortController: ac });

    // Start streaming in background (fire-and-forget with reconnect)
    // skipConnect: true for unit tests that don't have a live server
    if (!opts?.skipConnect) {
      this.connectBot(name, port, token, ac.signal).catch((err) => {
        log.debug("Bot SSE connection ended", { name, error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  /** Stop consuming SSE from a bot. */
  removeBot(name: string): void {
    const conn = this.connections.get(name);
    if (conn) {
      conn.abortController.abort();
      this.connections.delete(name);
    }
  }

  /** Get list of connected bot names. */
  get connectedBots(): string[] {
    return [...this.connections.keys()];
  }

  /** Shut down all connections. */
  shutdown(): void {
    for (const [name] of this.connections) {
      this.removeBot(name);
    }
  }

  /* v8 ignore start -- SSE streaming requires live bot runtime */
  private async connectBot(name: string, port: number, token: string, signal: AbortSignal): Promise<void> {
    let backoff = 1000;
    const MAX_BACKOFF = 30_000;

    while (!signal.aborted) {
      try {
        const url = `http://127.0.0.1:${port}/api/events`;
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        backoff = 1000; // Reset on successful connection
        const decoder = new TextDecoder();
        let buffer = "";

        for await (const chunk of response.body) {
          if (signal.aborted) break;
          buffer += decoder.decode(chunk as Uint8Array, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as AggregatedActivityEvent;
                if (event.type === "activity" || (event as Record<string, unknown>).type === "snapshot") {
                  this.injectEvent({ ...event, type: "activity", name });
                }
              } catch {
                // skip malformed
              }
            }
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        log.debug("Bot SSE reconnecting", { name, backoffMs: backoff });
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }
  }
  /* v8 ignore stop */
}
