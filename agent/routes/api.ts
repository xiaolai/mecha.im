import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { log } from "../../shared/logger.js";
import type { BotConfig } from "../types.js";
import type { SessionManager } from "../session.js";
import type { CostTracker } from "../costs.js";
import type { ActivityTracker } from "../activity.js";
import type { Mutex } from "../../shared/mutex.js";
import { readEvents } from "../event-log.js";

interface ApiDeps {
  config: BotConfig;
  startedAt: number;
  sessions: SessionManager;
  costs: CostTracker;
  activity: ActivityTracker;
  busy: Mutex;
}

export function createApiRoutes(deps: ApiDeps): Hono {
  const { config, startedAt, sessions, costs, activity, busy } = deps;
  const app = new Hono();

  app.get("/costs", (c) => {
    return c.json(costs.getCosts());
  });

  app.get("/tasks", (c) => {
    return c.json(sessions.listTasks());
  });

  app.get("/tasks/:id", (c) => {
    const task = sessions.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  });

  app.post("/bot/restart", (c) => {
    if (busy.isLocked) {
      const force = c.req.query("force") === "true";
      if (!force) {
        return c.json({ error: "Bot is busy", code: "BOT_BUSY", state: activity.getState() }, 409);
      }
    }
    log.info("Restart requested via dashboard");
    setTimeout(() => process.exit(0), 200);
    return c.json({ status: "restarting" });
  });

  app.post("/bot/stop", (c) => {
    if (busy.isLocked) {
      const force = c.req.query("force") === "true";
      if (!force) {
        return c.json({ error: "Bot is busy", code: "BOT_BUSY", state: activity.getState() }, 409);
      }
    }
    log.info("Stop requested via dashboard");
    try { writeFileSync("/state/stop-requested", ""); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 200);
    return c.json({ status: "stopping" });
  });

  // Cache CLI version (resolved once on first status call)
  let cachedCliVersion: string | null = null;
  function getCliVersion(): string {
    if (cachedCliVersion) return cachedCliVersion;
    try {
      cachedCliVersion = execFileSync("claude", ["--version"], { encoding: "utf-8", timeout: 5000 }).trim();
    } catch {
      cachedCliVersion = "unknown";
    }
    return cachedCliVersion;
  }

  app.get("/status", (c) => {
    const activeTask = sessions.getActiveTask();
    return c.json({
      name: config.name,
      state: activity.getState(),
      model: config.model,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      current_task: activeTask?.id ?? null,
      current_session_id: activeTask?.session_id ?? null,
      talking_to: activity.getTalkingTo(),
      last_active: activity.getLastActive(),
      claude_cli_version: getCliVersion(),
    });
  });

  app.get("/status/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      const snapshot = {
        activity: activity.getState(),
        talkingTo: activity.getTalkingTo(),
        lastActive: activity.getLastActive(),
      };
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });

      const onStateChange = (data: unknown) => {
        stream.writeSSE({ event: "state", data: JSON.stringify(data) }).catch(() => {});
      };
      activity.on("change", onStateChange);

      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => {});
      }, 30_000);

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          activity.off("change", onStateChange);
          clearInterval(heartbeat);
          resolve();
        });
      });
    });
  });

  app.get("/logs", (c) => {
    const rawLimit = parseInt(c.req.query("limit") ?? "100", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const source = c.req.query("source");
    let events = readEvents(limit);
    if (source) {
      events = events.filter((e) => e.type === source || e.source === source);
    }
    return c.json(events);
  });

  return app;
}
