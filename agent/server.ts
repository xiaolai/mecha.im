import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { timingSafeEqual } from "node:crypto";
import { Mutex } from "../shared/mutex.js";
import { log } from "../shared/logger.js";
import type { BotConfig } from "./types.js";
import { SessionManager, type TaskSource } from "./session.js";
import { CostTracker } from "./costs.js";
import { createMechaToolServer } from "./tools/mecha-server.js";
import { createWebhookRoutes, type WebhookState } from "./webhook.js";
import { ActivityTracker } from "./activity.js";
import type { Scheduler } from "./scheduler.js";
import { createDashboardRoutes, verifySessionCookie } from "./routes/dashboard.js";
import { SessionHistory } from "./session-history.js";
import type { PtyManager } from "./pty-manager.js";
import { promptSchema, INTERNAL_AUTH_HEADER, BOT_TOKEN, FLEET_INTERNAL_SECRET } from "./server-schema.js";
import { runClaude, activityStateForSource, promptSourceForRequest, getWorkspaceContext } from "./server-utils.js";
import { createScheduleRoutes } from "./routes/schedule.js";
import { createConfigRoutes } from "./routes/config.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createApiRoutes } from "./routes/api.js";
import { createWebhookConfigRoutes } from "./routes/webhooks.js";

export { buildClaudeOptions } from "./server-utils.js";
export type { PromptOverrides } from "./server-schema.js";

export function createApp(config: BotConfig, startedAt: number, ptyManager?: PtyManager) {
  const app = new Hono();

  const PORT = parseInt(process.env.MECHA_PORT ?? "3000", 10);
  const allowedOrigin = process.env.MECHA_CORS_ORIGIN || `http://localhost:${PORT}`;
  app.use("/*", cors({ origin: allowedOrigin }));

  const hasBearerAuth = (auth: string | undefined): boolean => {
    if (!auth) return false;
    const received = Buffer.from(auth);
    const expected = Buffer.from(`Bearer ${BOT_TOKEN}`);
    return received.length === expected.length && timingSafeEqual(received, expected);
  };
  const requireApiAuth = async (c: import("hono").Context, next: () => Promise<void>) => {
    if (hasBearerAuth(c.req.header("authorization")) || verifySessionCookie(c.req.header("cookie"), BOT_TOKEN)) {
      await next();
      return;
    }
    return c.json({ error: "Unauthorized" }, 401);
  };
  const requirePromptAuth = async (c: import("hono").Context, next: () => Promise<void>) => {
    if (hasBearerAuth(c.req.header("authorization")) || (FLEET_INTERNAL_SECRET && (() => {
      const val = c.req.header(INTERNAL_AUTH_HEADER);
      if (!val) return false;
      const received = Buffer.from(val);
      const expected = Buffer.from(FLEET_INTERNAL_SECRET);
      return received.length === expected.length && timingSafeEqual(received, expected);
    })())) {
      await next();
      return;
    }
    return c.json({ error: "Unauthorized" }, 401);
  };
  app.use("/prompt", requirePromptAuth);
  app.use("/api/*", requireApiAuth);

  const busy = new Mutex();
  const sessions = new SessionManager();
  const costs = new CostTracker();
  const mechaTools = createMechaToolServer(sessions, config);
  const activity = new ActivityTracker();
  let schedulerRef: Scheduler | undefined;

  const isBusy = () => busy.isLocked;
  const setScheduler = (s: Scheduler) => { schedulerRef = s; };

  async function handlePrompt(prompt: string, source: Exclude<TaskSource, "interactive"> = "schedule"): Promise<void> {
    const release = await busy.acquire();
    sessions.beginIsolatedTask(source);
    activity.transition(activityStateForSource(source));
    try {
      const result = await runClaude(prompt, config, undefined, undefined, [mechaTools]);
      if (result.sessionId) sessions.captureSessionId(result.sessionId);
      sessions.addCost(result.costUsd);
      costs.add(result.costUsd);
      if (result.success) {
        sessions.completeTask();
      } else {
        sessions.markError("Prompt run failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sessions.markError(message);
      activity.transition("error");
      setTimeout(() => {
        if (activity.getState() === "error") activity.transition("idle");
      }, 5000);
      throw err;
    } finally {
      if (activity.getState() !== "error") {
        activity.transition("idle");
      }
      release();
    }
  }

  // --- Routes ---

  app.get("/health", (c) => {
    return c.json({ status: "ok", name: config.name });
  });

  app.post("/prompt", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = promptSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request: message is required" }, 400);
    }

    const release = busy.tryAcquire();
    if (!release) {
      return c.json(
        { error: "Bot is busy processing another request", code: "BOT_BUSY" },
        409,
      );
    }
    const source = promptSourceForRequest(c, FLEET_INTERNAL_SECRET, INTERNAL_AUTH_HEADER);
    const isolatedTask = source !== "interactive";
    activity.transition(activityStateForSource(source));

    const { message, ...requestOverrides } = parsed.data;
    const hasOverrides = Object.keys(requestOverrides).length > 0 ? requestOverrides : undefined;

    const task = isolatedTask
      ? sessions.beginIsolatedTask(source)
      : sessions.ensureActiveTask("interactive");
    const resumeSessionId = requestOverrides.resume
      ? undefined
      : (isolatedTask ? undefined : sessions.getResumeSessionId());

    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({ event: "start", data: JSON.stringify({ task_id: task.id }) });

        const result = await runClaude(
          message,
          config,
          resumeSessionId,
          async (event) => {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event.data),
            });
          },
          [mechaTools],
          hasOverrides,
        );

        if (result.sessionId) sessions.captureSessionId(result.sessionId);
        sessions.addCost(result.costUsd);
        costs.add(result.costUsd);
        if (isolatedTask) {
          if (result.success) {
            sessions.completeTask();
          } else {
            sessions.markError("Prompt run failed");
          }
        }

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            cost_usd: result.costUsd,
            session_id: result.sessionId,
            duration_ms: result.durationMs,
            success: result.success,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Prompt stream error", { error: message });
        sessions.markError(message);
        activity.transition("error");
        setTimeout(() => {
          if (activity.getState() === "error") activity.transition("idle");
        }, 5000);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Internal error processing request" }) });
      } finally {
        if (activity.getState() !== "error") {
          activity.transition("idle");
        }
        release();
      }
    });
  });

  const { app: webhookApp, state: webhookState } = createWebhookRoutes(config, async (prompt) => {
    try {
      await handlePrompt(prompt, "webhook");
      return true;
    } catch (err) {
      log.error("Webhook handler error", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, isBusy);
  app.route("/", webhookApp);

  // Mount sub-apps
  app.route("/api", createApiRoutes({ config, startedAt, sessions, costs, activity, busy }));
  app.route("/api", createConfigRoutes(config, busy, activity));
  app.route("/api/schedule", createScheduleRoutes(() => schedulerRef));
  app.route("/api/webhooks", createWebhookConfigRoutes(config, webhookState));

  const workspace = getWorkspaceContext();
  const sessionHistory = new SessionHistory(workspace.cwd, ptyManager);
  app.route("/api/sessions", createSessionRoutes(sessionHistory));

  app.route("/", createDashboardRoutes(BOT_TOKEN));

  return { app, isBusy, handlePrompt, activity, setScheduler, botToken: BOT_TOKEN };
}
