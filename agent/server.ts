import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Mutex } from "../shared/mutex.js";
import { log } from "../shared/logger.js";
import type { BotConfig } from "./types.js";
import { SessionManager, type TaskSource } from "./session.js";
import { CostTracker } from "./costs.js";
import { createMechaToolServer } from "./tools/mecha-server.js";
import { createWebhookRoutes } from "./webhook.js";
import { ActivityTracker } from "./activity.js";
import { readEvents } from "./event-log.js";
import type { Scheduler } from "./scheduler.js";
import { createDashboardRoutes, verifySessionCookie } from "./routes/dashboard.js";
import { SessionHistory } from "./session-history.js";
import type { PtyManager } from "./pty-manager.js";
import type {
  QueryResult, SdkEvent, SdkSystemEvent, SdkAssistantEvent, SdkResultEvent,
} from "./server.types.js";

const promptSchema = z.object({
  message: z.string().min(1),
  // Optional overrides — CLI `mecha query` can pass these to customize per-request
  model: z.string().optional(),
  system: z.string().optional(),
  max_turns: z.number().int().min(1).max(200).optional(),
  resume: z.string().min(1).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  max_budget_usd: z.number().positive().optional(),
});
const INTERNAL_AUTH_HEADER = "x-mecha-internal-auth";

// Always require auth — auto-generate a token if none provided
const BOT_TOKEN = process.env.MECHA_BOT_TOKEN || ("mecha_agent_" + randomBytes(24).toString("hex"));
const FLEET_INTERNAL_SECRET = process.env.MECHA_FLEET_INTERNAL_SECRET;
if (!process.env.MECHA_BOT_TOKEN) {
  log.warn("MECHA_BOT_TOKEN not set — auto-generated token for this session. Set MECHA_BOT_TOKEN for stable auth.");
  log.info(`Auto-generated agent token: ${BOT_TOKEN.slice(0, 14)}...`);
}

function getWorkspaceContext(): { cwd: string; settingSources: Array<"user" | "project"> | ["user"] } {
  const configuredCwd = process.env.MECHA_WORKSPACE_CWD;
  const enableProjectSettings = process.env.MECHA_ENABLE_PROJECT_SETTINGS === "1";
  if (configuredCwd) {
    return {
      cwd: configuredCwd,
      settingSources: enableProjectSettings ? ["user", "project"] : ["user"],
    };
  }

  if (existsSync("/home/appuser/workspace")) {
    return {
      cwd: "/home/appuser/workspace",
      settingSources: ["user", "project"],
    };
  }

  return {
    cwd: "/state/home-workspace",
    settingSources: ["user"],
  };
}

export type PromptOverrides = Omit<z.infer<typeof promptSchema>, "message">;

export function buildClaudeOptions(
  config: BotConfig,
  resumeSessionId?: string,
  mcpServers?: Record<string, unknown>[],
  overrides?: PromptOverrides,
): Record<string, unknown> {
  const workspace = getWorkspaceContext();
  const options: Record<string, unknown> = {
    model: overrides?.model ?? config.model,
    cwd: workspace.cwd,
    maxTurns: overrides?.max_turns ?? config.max_turns ?? 25,
    env: { ...process.env },
    permissionMode: config.permission_mode,
    settingSources: [...workspace.settingSources],
  };

  if (config.permission_mode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }

  const systemPrompt = overrides?.system ?? config.system;
  if (systemPrompt) {
    options.systemPrompt = systemPrompt;
  }

  const budget = overrides?.max_budget_usd ?? config.max_budget_usd;
  if (budget) {
    options.maxBudgetUsd = budget;
  }

  if (overrides?.effort) {
    options.effort = overrides.effort;
  }

  // Resume priority: explicit override > session-based resume
  const resumeId = overrides?.resume ?? resumeSessionId;
  if (resumeId) {
    options.resume = resumeId;
  }

  if (mcpServers?.length) {
    options.mcpServers = mcpServers;
  }

  return options;
}

/** Run claude via SDK query() and iterate async events */
async function runClaude(
  message: string,
  config: BotConfig,
  resumeSessionId?: string,
  onEvent?: (event: { type: string; data: unknown }) => void,
  mcpServers?: Record<string, unknown>[],
  overrides?: PromptOverrides,
): Promise<QueryResult> {
  const options = buildClaudeOptions(config, resumeSessionId, mcpServers, overrides);
  const response = query({ prompt: message, options });

  let resultText = "";
  let costUsd = 0;
  let sessionId = "";
  let durationMs = 0;
  let success = false;

  for await (const rawEvent of response) {
    const event = rawEvent as SdkEvent;

    // Capture session ID from init event
    if (event.type === "system") {
      const sysEvent = event as SdkSystemEvent;
      if (sysEvent.subtype === "init" && sysEvent.session_id) {
        sessionId = sysEvent.session_id;
      }
    }

    // Stream assistant text and tool use
    if (event.type === "assistant") {
      const assistEvent = event as SdkAssistantEvent;
      if (assistEvent.message?.content) {
        for (const block of assistEvent.message.content) {
          if (block.type === "text" && block.text) {
            resultText += block.text;
            onEvent?.({ type: "text", data: { content: block.text } });
          }
          if (block.type === "tool_use") {
            onEvent?.({ type: "tool_use", data: { tool: block.name, input: block.input } });
          }
        }
      }
    }

    // Capture final result
    if (event.type === "result") {
      const resEvent = event as SdkResultEvent;
      costUsd = resEvent.total_cost_usd ?? 0;
      sessionId = resEvent.session_id ?? sessionId;
      durationMs = resEvent.duration_ms ?? 0;
      success = resEvent.subtype === "success";
      resultText = resEvent.result ?? resultText;
    }
  }

  return { text: resultText, costUsd, sessionId, durationMs, success };
}

function hasInternalAuthHeader(value: string | undefined): boolean {
  if (!FLEET_INTERNAL_SECRET || !value) return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(FLEET_INTERNAL_SECRET);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function promptSourceForRequest(c: import("hono").Context): TaskSource {
  return hasInternalAuthHeader(c.req.header(INTERNAL_AUTH_HEADER)) ? "interbot" : "interactive";
}

function activityStateForSource(source: TaskSource): "thinking" | "calling" | "scheduled" | "webhook" {
  if (source === "interbot") return "calling";
  if (source === "schedule") return "scheduled";
  if (source === "webhook") return "webhook";
  return "thinking";
}

function formatToolContext(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Read": case "Edit": case "Write": return String(obj.file_path ?? "");
    case "Bash": return String(obj.command ?? "").slice(0, 80);
    case "Grep": case "Glob": return String(obj.pattern ?? "");
    case "WebSearch": return String(obj.query ?? "");
    default: return "";
  }
}

export function createApp(config: BotConfig, startedAt: number, ptyManager?: PtyManager) {
  const app = new Hono();

  // CORS — default to same-origin (localhost:PORT); override with MECHA_CORS_ORIGIN
  const PORT = parseInt(process.env.MECHA_PORT ?? "3000", 10);
  const allowedOrigin = process.env.MECHA_CORS_ORIGIN || `http://localhost:${PORT}`;
  app.use("/*", cors({ origin: allowedOrigin }));

  // Auth middleware for API routes (health and dashboard are public)
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
    if (hasBearerAuth(c.req.header("authorization")) || hasInternalAuthHeader(c.req.header(INTERNAL_AUTH_HEADER))) {
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
  const mechaTools = createMechaToolServer(sessions);
  const activity = new ActivityTracker();
  let schedulerRef: Scheduler | undefined;

  const isBusy = () => busy.isLocked;
  const setScheduler = (s: Scheduler) => { schedulerRef = s; };

  // Handle prompt from scheduler/webhook (no SSE stream)
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

    // Atomic try-acquire eliminates the TOCTOU race between isLocked check and acquire
    const release = busy.tryAcquire();
    if (!release) {
      return c.json(
        { error: "Bot is busy processing another request", code: "BOT_BUSY" },
        409,
      );
    }
    const source = promptSourceForRequest(c);
    const isolatedTask = source !== "interactive";
    activity.transition(activityStateForSource(source));

    // Extract per-request overrides from the prompt body
    const { message, ...requestOverrides } = parsed.data;
    const hasOverrides = Object.keys(requestOverrides).length > 0 ? requestOverrides : undefined;

    // If an explicit resume session is provided, use it; otherwise use session-based resume
    const task = isolatedTask
      ? sessions.beginIsolatedTask(source)
      : sessions.ensureActiveTask("interactive");
    const resumeSessionId = requestOverrides.resume
      ? undefined  // explicit resume in overrides takes priority
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

  // Webhook routes
  if (config.webhooks) {
    const webhookApp = createWebhookRoutes(config, async (prompt) => {
      try {
        await handlePrompt(prompt, "webhook");
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
    // Detect auth type from env vars
    const hasOauth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const authType = hasOauth ? "oauth" : hasApiKey ? "api_key" : "unknown";

    // Only expose non-sensitive config fields
    return c.json({
      name: config.name,
      model: config.model,
      auth_type: authType,
      auth_profile: config.auth ?? null,
      max_turns: config.max_turns,
      permission_mode: config.permission_mode,
      workspace: config.workspace ? true : undefined,
      workspace_writable: config.workspace_writable,
      schedule: config.schedule?.length ?? 0,
      webhooks: config.webhooks ? { accept: config.webhooks.accept } : undefined,
    });
  });

  // --- Auth management (reads from mounted credentials.yaml) ---

  const CREDENTIALS_PATH = "/state/credentials.yaml";
  const CONFIG_PATH = process.env.MECHA_CONFIG_PATH ?? "/config/bot.yaml";

  app.get("/api/auth/profiles", (c) => {
    if (!existsSync(CREDENTIALS_PATH)) {
      return c.json({ current_profile: config.auth ?? null, profiles: [] });
    }
    try {
      const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
      const parsed = parseYaml(raw) as { credentials?: Array<{ name: string; type: string }> };
      const claudeProfiles = (parsed.credentials ?? [])
        .filter((cr) => cr.type === "api_key" || cr.type === "oauth_token")
        .map((cr) => ({ name: cr.name, type: cr.type }));
      return c.json({ current_profile: config.auth ?? null, profiles: claudeProfiles });
    } catch {
      return c.json({ current_profile: config.auth ?? null, profiles: [] });
    }
  });

  app.post("/api/auth/switch", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.profile !== "string") {
      return c.json({ error: "profile is required" }, 400);
    }
    const profile = body.profile as string;

    // Verify profile exists in credentials
    if (!existsSync(CREDENTIALS_PATH)) {
      return c.json({ error: "No credentials file available" }, 400);
    }
    let cred: { name: string; type: string } | undefined;
    try {
      const credsRaw = readFileSync(CREDENTIALS_PATH, "utf-8");
      const credsParsed = parseYaml(credsRaw) as { credentials?: Array<{ name: string; type: string }> };
      cred = credsParsed.credentials?.find((cr) => cr.name === profile);
    } catch {
      return c.json({ error: "Failed to read credentials file" }, 500);
    }
    if (!cred || (cred.type !== "api_key" && cred.type !== "oauth_token")) {
      return c.json({ error: `Profile "${profile}" not found or not a Claude auth credential` }, 404);
    }

    // Check busy state unless force=true
    const force = c.req.query("force") === "true";
    if (!force && busy.isLocked) {
      return c.json({ error: "Bot is busy", code: "BOT_BUSY", state: activity.getState() }, 409);
    }

    // Update bot.yaml auth field
    try {
      const configRaw = readFileSync(CONFIG_PATH, "utf-8");
      const configParsed = parseYaml(configRaw) as Record<string, unknown>;
      configParsed.auth = profile;
      writeFileSync(CONFIG_PATH, stringifyYaml(configParsed));
      log.info(`Auth profile switched to "${profile}", restarting...`);
    } catch (err) {
      return c.json({ error: "Failed to update config" }, 500);
    }

    // Self-restart: exit with code 0, Docker restart policy will restart with new auth
    setTimeout(() => process.exit(0), 200);
    return c.json({ status: "switching", profile, message: "Bot is restarting with new auth..." });
  });

  // --- Bot lifecycle controls ---

  app.post("/api/bot/restart", (c) => {
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

  app.post("/api/bot/stop", (c) => {
    if (busy.isLocked) {
      const force = c.req.query("force") === "true";
      if (!force) {
        return c.json({ error: "Bot is busy", code: "BOT_BUSY", state: activity.getState() }, 409);
      }
    }
    log.info("Stop requested via dashboard");
    // Write stop marker so s6 doesn't restart
    try { writeFileSync("/state/stop-requested", ""); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 200);
    return c.json({ status: "stopping" });
  });

  app.get("/api/status", (c) => {
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
    });
  });

  app.get("/api/status/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial snapshot on connect
      const snapshot = {
        activity: activity.getState(),
        talkingTo: activity.getTalkingTo(),
        lastActive: activity.getLastActive(),
      };
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });

      // Subscribe to state changes
      const onStateChange = (data: unknown) => {
        stream.writeSSE({ event: "state", data: JSON.stringify(data) }).catch(() => {});
      };
      activity.on("change", onStateChange);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => {});
      }, 30_000);

      // Keep alive until client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          activity.off("change", onStateChange);
          clearInterval(heartbeat);
          resolve();
        });
      });
    });
  });

  app.get("/api/logs", (c) => {
    const rawLimit = parseInt(c.req.query("limit") ?? "100", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const source = c.req.query("source");
    let events = readEvents(limit);
    if (source) {
      events = events.filter((e) => e.type === source || e.source === source);
    }
    return c.json(events);
  });

  app.get("/api/schedule", (c) => {
    if (!schedulerRef) return c.json([]);
    return c.json(schedulerRef.getStatus());
  });

  app.post("/api/schedule", async (c) => {
    if (!schedulerRef) return c.json({ error: "Scheduler not initialized" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.cron !== "string" || typeof body.prompt !== "string") {
      return c.json({ error: "cron and prompt are required" }, 400);
    }
    const { cron, prompt } = body as { cron: string; prompt: string };
    if (!prompt.trim()) return c.json({ error: "prompt cannot be empty" }, 400);
    const result = schedulerRef.addEntry(cron, prompt.trim());
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ id: result.id, status: "created" }, 201);
  });

  app.put("/api/schedule/:id", async (c) => {
    if (!schedulerRef) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Request body required" }, 400);
    const updates: { cron?: string; prompt?: string } = {};
    if (typeof body.cron === "string") updates.cron = body.cron;
    if (typeof body.prompt === "string") updates.prompt = body.prompt.trim();
    if (!updates.cron && !updates.prompt) return c.json({ error: "cron or prompt required" }, 400);
    const result = schedulerRef.updateEntry(id, updates);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ status: "updated" });
  });

  app.delete("/api/schedule/:id", (c) => {
    if (!schedulerRef) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = schedulerRef.removeEntry(id);
    if (!ok) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ status: "deleted" });
  });

  app.post("/api/schedule/:id/pause", (c) => {
    if (!schedulerRef) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = schedulerRef.pauseEntry(id);
    if (!ok) return c.json({ error: "Entry not found or already paused" }, 400);
    return c.json({ status: "paused" });
  });

  app.post("/api/schedule/:id/resume", (c) => {
    if (!schedulerRef) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const result = schedulerRef.resumeEntry(id);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ status: "resumed" });
  });

  app.post("/api/schedule/trigger/:id", async (c) => {
    if (!schedulerRef) return c.json({ error: "No scheduler" }, 404);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = await schedulerRef.triggerNow(id);
    if (!ok) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ status: "triggered" });
  });

  // Session history — JSONL-based conversation browser
  const workspace = getWorkspaceContext();
  const sessionHistory = new SessionHistory(workspace.cwd, ptyManager);

  app.get("/api/sessions", async (c) => {
    try {
      const list = await sessionHistory.list();
      return c.json(list);
    } catch (err) {
      log.error("Failed to list sessions", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to list sessions" }, 500);
    }
  });

  app.get("/api/sessions/search", async (c) => {
    try {
      const q = (c.req.query("q") ?? "").slice(0, 500);
      if (!q.trim()) return c.json([]);
      const results = await sessionHistory.search(q);
      return c.json(results);
    } catch (err) {
      log.error("Failed to search sessions", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to search sessions" }, 500);
    }
  });

  app.get("/api/sessions/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const detail = await sessionHistory.getConversation(id);
      if (!detail) return c.json({ error: "Session not found" }, 404);
      return c.json(detail);
    } catch (err) {
      log.error("Failed to get session", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to get session" }, 500);
    }
  });

  // Bot dashboard static files
  app.route("/", createDashboardRoutes(BOT_TOKEN));

  return { app, isBusy, handlePrompt, activity, setScheduler, botToken: BOT_TOKEN };
}
