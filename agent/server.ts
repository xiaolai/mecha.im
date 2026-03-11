import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { resolve, normalize } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Mutex } from "../shared/mutex.js";
import { log } from "../shared/logger.js";
import type { BotConfig } from "./types.js";
import { SessionManager } from "./session.js";
import { CostTracker } from "./costs.js";
import { createMechaToolServer } from "./tools/mecha-server.js";
import { createWebhookRoutes } from "./webhook.js";
import { ActivityTracker } from "./activity.js";
import { readEvents } from "./event-log.js";
import type { Scheduler } from "./scheduler.js";

const promptSchema = z.object({
  message: z.string().min(1),
});

// Always require auth — auto-generate a token if none provided
const BOT_TOKEN = process.env.MECHA_BOT_TOKEN || ("mecha_agent_" + randomBytes(24).toString("hex"));
if (!process.env.MECHA_BOT_TOKEN) {
  log.warn("MECHA_BOT_TOKEN not set — auto-generated token for this session. Set MECHA_BOT_TOKEN for stable auth.");
  log.info(`Auto-generated agent token: ${BOT_TOKEN}`);
}

interface QueryResult {
  text: string;
  costUsd: number;
  sessionId: string;
  durationMs: number;
  success: boolean;
}

/** Run claude via SDK query() and iterate async events */
async function runClaude(
  message: string,
  config: BotConfig,
  resumeSessionId?: string,
  onEvent?: (event: { type: string; data: unknown }) => void,
  mcpServers?: Record<string, unknown>[],
): Promise<QueryResult> {
  const cwd = existsSync("/workspace") ? "/workspace" : "/app";

  const options: Record<string, unknown> = {
    model: config.model,
    cwd,
    maxTurns: config.max_turns ?? 25,
    env: { ...process.env },
    permissionMode: config.permission_mode,
    settingSources: ["user", "project"],
  };

  if (config.permission_mode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }

  if (config.system) {
    options.systemPrompt = config.system;
  }

  if (config.max_budget_usd) {
    options.maxBudgetUsd = config.max_budget_usd;
  }

  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  if (mcpServers?.length) {
    options.mcpServers = mcpServers;
  }

  const response = query({ prompt: message, options });

  let resultText = "";
  let costUsd = 0;
  let sessionId = "";
  let durationMs = 0;
  let success = false;

  for await (const event of response) {
    // Capture session ID from init event
    if (event.type === "system" && (event as any).subtype === "init" && (event as any).session_id) {
      sessionId = (event as any).session_id;
    }

    // Stream assistant text and tool use
    if (event.type === "assistant" && (event as any).message?.content) {
      for (const block of (event as any).message.content) {
        if (block.type === "text" && block.text) {
          resultText += block.text;
          onEvent?.({ type: "text", data: { content: block.text } });
        }
        if (block.type === "tool_use") {
          onEvent?.({ type: "tool_use", data: { tool: block.name, input: block.input } });
        }
      }
    }

    // Capture final result
    if (event.type === "result") {
      costUsd = (event as any).total_cost_usd ?? 0;
      sessionId = (event as any).session_id ?? sessionId;
      durationMs = (event as any).duration_ms ?? 0;
      success = (event as any).subtype === "success";
      resultText = (event as any).result ?? resultText;
    }
  }

  return { text: resultText, costUsd, sessionId, durationMs, success };
}

export function createApp(config: BotConfig, startedAt: number) {
  const app = new Hono();

  // CORS — default to same-origin (localhost:PORT); override with MECHA_CORS_ORIGIN
  const PORT = parseInt(process.env.MECHA_PORT ?? "3000", 10);
  const allowedOrigin = process.env.MECHA_CORS_ORIGIN || `http://localhost:${PORT}`;
  app.use("/*", cors({ origin: allowedOrigin }));

  // Auth middleware for API routes (health and dashboard are public)
  const requireAuth = async (c: import("hono").Context, next: () => Promise<void>) => {
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${BOT_TOKEN}`) return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
  app.use("/prompt", requireAuth);
  app.use("/api/*", requireAuth);

  const busy = new Mutex();
  const sessions = new SessionManager();
  const costs = new CostTracker();
  const mechaTools = createMechaToolServer(sessions);
  const activity = new ActivityTracker();
  let schedulerRef: Scheduler | undefined;

  const isBusy = () => busy.isLocked;
  const setScheduler = (s: Scheduler) => { schedulerRef = s; };

  // Handle prompt from scheduler/webhook (no SSE stream)
  async function handlePrompt(prompt: string): Promise<void> {
    const release = await busy.acquire();
    activity.transition("thinking");
    try {
      const resumeSessionId = sessions.getResumeSessionId();
      const result = await runClaude(prompt, config, resumeSessionId, undefined, [mechaTools]);
      if (result.sessionId) sessions.captureSessionId(result.sessionId);
      sessions.addCost(result.costUsd);
      costs.add(result.costUsd);
    } finally {
      activity.transition("idle");
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

    // Atomic try-acquire eliminates the TOCTOU race between isLocked check and acquire
    const release = busy.tryAcquire();
    if (!release) {
      return c.json(
        { error: "Bot is busy processing another request", code: "BOT_BUSY" },
        409,
      );
    }
    activity.transition("thinking");

    const task = sessions.ensureActiveTask();
    const resumeSessionId = sessions.getResumeSessionId();

    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({ event: "start", data: JSON.stringify({ task_id: task.id }) });

        const result = await runClaude(
          parsed.data.message,
          config,
          resumeSessionId,
          async (event) => {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event.data),
            });
          },
          [mechaTools],
        );

        if (result.sessionId) sessions.captureSessionId(result.sessionId);
        sessions.addCost(result.costUsd);
        costs.add(result.costUsd);

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
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Internal error processing request" }) });
      } finally {
        activity.transition("idle");
        release();
      }
    });
  });

  // Webhook routes
  if (config.webhooks) {
    const webhookApp = createWebhookRoutes(config, async (prompt) => {
      try {
        await handlePrompt(prompt);
        return true;
      } catch (err) {
        log.error("Webhook handler error", { error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    }, isBusy);
    app.route("/", webhookApp);
  }

  // --- API routes (require auth) ---

  app.get("/api/costs", (c) => {
    return c.json(costs.getCosts());
  });

  app.get("/api/tasks", (c) => {
    return c.json(sessions.listTasks());
  });

  app.get("/api/tasks/:id", (c) => {
    const task = sessions.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  });

  app.get("/api/config", (c) => {
    // Only expose non-sensitive config fields
    return c.json({
      name: config.name,
      model: config.model,
      max_turns: config.max_turns,
      permission_mode: config.permission_mode,
      workspace: config.workspace ? true : undefined,
      workspace_writable: config.workspace_writable,
      schedule: config.schedule?.length ?? 0,
      webhooks: config.webhooks ? { accept: config.webhooks.accept } : undefined,
    });
  });

  app.get("/api/status", (c) => {
    const activeTask = sessions.getActiveTask();
    return c.json({
      name: config.name,
      state: activity.getState(),
      model: config.model,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      current_task: activeTask?.id ?? null,
      talking_to: activity.getTalkingTo(),
      last_active: activity.getLastActive(),
    });
  });

  app.get("/api/status/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      const onChange = (data: unknown) => {
        stream.writeSSE({ event: "state", data: JSON.stringify(data) }).catch(() => {
          // client disconnected, will be cleaned up by abort handler
        });
      };
      activity.on("change", onChange);
      // Keep alive until client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          activity.off("change", onChange);
          resolve();
        });
      });
    });
  });

  app.get("/api/logs", (c) => {
    const rawLimit = parseInt(c.req.query("limit") ?? "100", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    return c.json(readEvents(limit));
  });

  app.get("/api/schedule", (c) => {
    if (!schedulerRef) return c.json([]);
    return c.json(schedulerRef.getStatus());
  });

  app.post("/api/schedule/trigger/:id", async (c) => {
    if (!schedulerRef) return c.json({ error: "No scheduler" }, 404);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = await schedulerRef.triggerNow(id);
    if (!ok) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ status: "triggered" });
  });

  // --- Serve bot dashboard static files ---
  const DASHBOARD_ROOT = "/app/agent/dashboard/dist";

  app.get("/dashboard/*", async (c) => {
    const reqPath = c.req.path.replace("/dashboard", "") || "/index.html";
    const resolved = resolve(DASHBOARD_ROOT, reqPath.replace(/^\//, ""));
    const normalized = normalize(resolved);

    // Path traversal protection (trailing separator prevents prefix bypasses like /dist-evil/)
    if (normalized !== DASHBOARD_ROOT && !normalized.startsWith(DASHBOARD_ROOT + "/")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(normalized);
      const ext = normalized.split(".").pop() ?? "";
      const types: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
      };
      return c.body(content, 200, {
        "Content-Type": types[ext] ?? "application/octet-stream",
      });
    } catch {
      // SPA fallback
      try {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(`${DASHBOARD_ROOT}/index.html`);
        return c.body(html, 200, { "Content-Type": "text/html" });
      } catch {
        return c.json({ error: "Dashboard not built" }, 404);
      }
    }
  });

  return { app, isBusy, handlePrompt, activity, setScheduler };
}
