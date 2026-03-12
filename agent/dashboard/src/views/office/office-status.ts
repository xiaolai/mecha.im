import { botFetch, botSSE } from "../../lib/api";
import type { OfficeBridge, ActivityState } from "./office-bridge";

interface StatusResponse {
  state: ActivityState;
  talking_to: string | null;
  current_session_id?: string | null;
  last_active: string | null;
}

export function startOfficeStatus(bridge: OfficeBridge): () => void {
  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let idleStartedAt: number | null = null;

  function writeBridge(): void {
    bridge.revision++;
  }

  function startIdleTimer(): void {
    if (idleTimer) clearInterval(idleTimer);
    idleStartedAt = Date.now();
    idleTimer = setInterval(() => {
      if (idleStartedAt) {
        bridge.state.idleSinceSec = Math.floor((Date.now() - idleStartedAt) / 1000);
        writeBridge();
      }
    }, 1000);
  }

  function stopIdleTimer(): void {
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    idleStartedAt = null;
    bridge.state.idleSinceSec = 0;
  }

  function connectSSE(): void {
    if (disposed) return;

    es = botSSE("/api/status/stream", {
      onEvent: (eventType, data) => {
        if (disposed) return;
        try {
          switch (eventType) {
            case "snapshot": {
              const snap = JSON.parse(data) as StatusResponse;
              bridge.state.activity = snap.state;
              bridge.state.talkingTo = snap.talking_to;
              if (snap.state === "idle") startIdleTimer();
              writeBridge();
              break;
            }
            case "state": {
              const s = JSON.parse(data) as { prev: string; state: ActivityState; talkingTo: string | null };
              bridge.state.activity = s.state;
              bridge.state.talkingTo = s.talkingTo;
              if (s.state === "idle") {
                startIdleTimer();
              } else {
                stopIdleTimer();
              }
              writeBridge();
              break;
            }
            case "tool": {
              const t = JSON.parse(data) as { name: string; context: string };
              bridge.state.currentTool = t.name;
              bridge.state.currentToolContext = t.context;
              writeBridge();
              break;
            }
            case "subagent": {
              const sa = JSON.parse(data) as { action: string; id: string; type?: string; description?: string };
              if (sa.action === "spawn") {
                bridge.state.subagents = [
                  ...bridge.state.subagents,
                  { id: sa.id, type: sa.type ?? "general", description: sa.description ?? "" },
                ];
              } else if (sa.action === "complete") {
                bridge.state.subagents = bridge.state.subagents.filter((s) => s.id !== sa.id);
              }
              writeBridge();
              break;
            }
            case "heartbeat":
              break;
          }
        } catch (err) {
          console.warn("[office-status] Failed to parse SSE event:", err);
        }
      },
      onError: () => {},
    });
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const [costsRes, tasksRes, scheduleRes] = await Promise.all([
        botFetch("/api/costs"),
        botFetch("/api/tasks"),
        botFetch("/api/schedule"),
      ]);

      if (costsRes.ok) {
        const costs = await costsRes.json();
        bridge.state.costToday = costs.today ?? 0;
      }

      if (tasksRes.ok) {
        const tasks = await tasksRes.json();
        const active = Array.isArray(tasks)
          ? tasks.find((t: { status: string }) => t.status === "running")
          : null;
        bridge.state.taskStartedAt = active?.started_at ?? null;
        bridge.state.currentSessionId = active?.session_id ?? null;
      }

      if (scheduleRes.ok) {
        const schedule = await scheduleRes.json();
        if (Array.isArray(schedule) && schedule.length > 0) {
          bridge.state.scheduleNextRunAt = schedule[0].nextRunAt ?? null;
          bridge.state.consecutiveErrors = schedule[0].consecutiveErrors ?? 0;
        }
      }

      writeBridge();
    } catch (err) {
      console.warn("[office-status] Poll failed:", err);
    }
  }

  async function bootstrap(): Promise<void> {
    try {
      const statusRes = await botFetch("/api/status");
      if (statusRes.ok) {
        const status = (await statusRes.json()) as StatusResponse;
        bridge.state.activity = status.state;
        bridge.state.talkingTo = status.talking_to;
        bridge.state.currentSessionId = status.current_session_id ?? null;
        if (status.state === "idle") startIdleTimer();
      }

      const charRes = await botFetch("/api/config/character");
      if (charRes.ok) {
        const char = await charRes.json();
        bridge.character.skin = char.skin ?? 0;
        bridge.character.hair = char.hair ?? 0;
        bridge.character.outfit = char.outfit ?? "outfit1";
      }

      writeBridge();
    } catch (err) {
      console.warn("[office-status] Bootstrap failed:", err);
    }

    await poll();
  }

  bootstrap();
  connectSSE();
  pollTimer = setInterval(poll, 10_000);

  return () => {
    disposed = true;
    es?.close();
    if (pollTimer) clearInterval(pollTimer);
    stopIdleTimer();
  };
}
