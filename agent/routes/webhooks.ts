import { Hono } from "hono";
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { BotConfig } from "../types.js";
import type { WebhookState } from "../webhook.js";

const CONFIG_PATH = process.env.MECHA_CONFIG_PATH ?? "/config/bot.yaml";

const updateSchema = z.object({
  accept: z.array(z.string().min(1)).max(50).optional(),
  secret: z.string().min(1).nullable().optional(),
}).refine(obj => obj.accept !== undefined || obj.secret !== undefined, {
  message: "At least one of accept or secret is required",
});

const addEventSchema = z.object({
  event: z.string().min(1),
});

function persistWebhooks(accept: string[], secret?: string | null): void {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  const webhooks = (parsed.webhooks ?? {}) as Record<string, unknown>;
  webhooks.accept = accept;
  if (secret === null) {
    delete webhooks.secret;
  } else if (secret !== undefined) {
    webhooks.secret = secret;
  }
  parsed.webhooks = webhooks;
  writeFileSync(CONFIG_PATH, stringifyYaml(parsed));
}

export function createWebhookConfigRoutes(
  config: BotConfig,
  webhookState: WebhookState,
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      accept: webhookState.accept,
      secret_set: !!webhookState.secret,
      endpoint: "/webhook",
    });
  });

  app.put("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const result = updateSchema.safeParse(body);
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);

    const { accept, secret } = result.data;
    const newAccept = accept ?? webhookState.accept;

    try {
      persistWebhooks(newAccept, secret);
      webhookState.accept = newAccept;
      if (secret === null) webhookState.secret = undefined;
      else if (secret !== undefined) webhookState.secret = secret;
      return c.json({ status: "updated", accept: newAccept, secret_set: !!webhookState.secret });
    } catch {
      return c.json({ error: "Failed to update config" }, 500);
    }
  });

  app.post("/accept", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const result = addEventSchema.safeParse(body);
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);

    const current = webhookState.accept;
    if (current.includes(result.data.event)) {
      return c.json({ error: "Event type already in accept list" }, 409);
    }
    if (current.length >= 50) {
      return c.json({ error: "Accept list cannot exceed 50 items" }, 400);
    }

    const newAccept = [...current, result.data.event];
    try {
      persistWebhooks(newAccept);
      webhookState.accept = newAccept;
      return c.json({ status: "added", accept: newAccept });
    } catch {
      return c.json({ error: "Failed to update config" }, 500);
    }
  });

  app.delete("/accept/:event", (c) => {
    const event = c.req.param("event");
    const current = webhookState.accept;
    const newAccept = current.filter((e) => e !== event);
    if (newAccept.length === current.length) {
      return c.json({ error: "Event type not found" }, 404);
    }

    try {
      persistWebhooks(newAccept);
      webhookState.accept = newAccept;
      return c.json({ status: "removed", accept: newAccept });
    } catch {
      return c.json({ error: "Failed to update config" }, 500);
    }
  });

  return app;
}
