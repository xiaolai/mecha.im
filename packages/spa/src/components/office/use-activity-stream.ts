import { useEffect, useRef } from "react";
import type { ActivityEvent } from "./types";

/** Parse a single SSE line into an ActivityEvent (or null). Exported for testing. */
export function parseSSELine(line: string): ActivityEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as ActivityEvent;
  } catch {
    return null;
  }
}

/**
 * React hook that consumes the daemon's unified SSE stream
 * and calls onEvent for each ActivityEvent.
 */
export function useActivityStream(onEvent: (event: ActivityEvent) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let backoff = 1000;
    const MAX_BACKOFF = 30_000;

    async function connect() {
      if (cancelled) return;

      try {
        const response = await fetch("/events", {
          headers: { accept: "text/event-stream" },
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE failed: ${response.status}`);
        }

        backoff = 1000; // Reset on success
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const event = parseSSELine(line);
            if (event && event.type === "activity") {
              onEventRef.current(event);
            }
          }
        }
      } catch {
        // Reconnect with backoff
      }

      if (!cancelled) {
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
    };
  }, []);
}
