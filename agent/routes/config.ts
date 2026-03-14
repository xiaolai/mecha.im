import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { log } from "../../shared/logger.js";
import type { BotConfig } from "../types.js";
import type { Mutex } from "../../shared/mutex.js";
import type { ActivityTracker } from "../activity.js";

const configUpdateSchema = z.object({
  model: z.string().min(1).optional(),
  max_turns: z.number().int().min(1).max(100).optional(),
  permission_mode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"]).optional(),
  system: z.string().min(1).optional(),
  auth: z.string().min(1).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: "No fields to update" });

const CREDENTIALS_PATH = "/state/credentials.yaml";
const CONFIG_PATH = process.env.MECHA_CONFIG_PATH ?? "/config/bot.yaml";

export function createConfigRoutes(config: BotConfig, busy: Mutex, activity: ActivityTracker): Hono {
  const app = new Hono();

  app.get("/config", (c) => {
    const hasOauth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const authType = hasOauth ? "oauth" : hasApiKey ? "api_key" : "unknown";

    return c.json({
      name: config.name,
      model: config.model,
      auth_type: authType,
      auth_profile: config.auth ?? null,
      max_turns: config.max_turns,
      permission_mode: config.permission_mode,
      workspace: config.workspace ? true : undefined,
      workspace_writable: config.workspace_writable,
      system: config.system,
      schedule: config.schedule?.length ?? 0,
      webhooks: config.webhooks ? { accept: config.webhooks.accept } : undefined,
    });
  });

  app.get("/auth/profiles", (c) => {
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

  app.put("/config", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const result = configUpdateSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: result.error.issues[0].message }, 400);
    }

    const updates = result.data;

    // Validate auth profile if being changed
    if (updates.auth !== undefined) {
      if (!existsSync(CREDENTIALS_PATH)) {
        return c.json({ error: "No credentials file available" }, 400);
      }
      try {
        const credsRaw = readFileSync(CREDENTIALS_PATH, "utf-8");
        const credsParsed = parseYaml(credsRaw) as { credentials?: Array<{ name: string; type: string }> };
        const cred = credsParsed.credentials?.find((cr) => cr.name === updates.auth);
        if (!cred || (cred.type !== "api_key" && cred.type !== "oauth_token")) {
          return c.json({ error: `Profile "${updates.auth}" not found or not a Claude auth credential` }, 404);
        }
      } catch {
        return c.json({ error: "Failed to read credentials file" }, 500);
      }
    }

    const force = c.req.query("force") === "true";
    if (!force && busy.isLocked) {
      return c.json({ error: "Bot is busy", code: "BOT_BUSY", state: activity.getState() }, 409);
    }

    try {
      const configRaw = readFileSync(CONFIG_PATH, "utf-8");
      const configParsed = parseYaml(configRaw) as Record<string, unknown>;
      const changes: Record<string, unknown> = {};

      if (updates.model !== undefined) { configParsed.model = updates.model; changes.model = updates.model; }
      if (updates.max_turns !== undefined) { configParsed.max_turns = updates.max_turns; changes.max_turns = updates.max_turns; }
      if (updates.permission_mode !== undefined) { configParsed.permission_mode = updates.permission_mode; changes.permission_mode = updates.permission_mode; }
      if (updates.system !== undefined) { configParsed.system = updates.system; changes.system = updates.system; }
      if (updates.auth !== undefined) { configParsed.auth = updates.auth; changes.auth = updates.auth; }

      writeFileSync(CONFIG_PATH, stringifyYaml(configParsed));
      log.info(`Config updated: ${JSON.stringify(changes)}, restarting...`);

      setTimeout(() => process.exit(0), 200);
      return c.json({ status: "updating", changes, message: "Bot is restarting with updated config..." });
    } catch {
      return c.json({ error: "Failed to update config" }, 500);
    }
  });

  return app;
}
