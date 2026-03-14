import { Hono } from "hono";
import type { Context } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { log } from "../shared/logger.js";
import type { BotConfig } from "./types.js";

export type WebhookHandler = (prompt: string) => Promise<boolean>;

const MAX_PAYLOAD_BYTES = 100_000;

function safeExtractPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { installation, sender, repository, ...rest } = body;
  const safe: Record<string, unknown> = { ...rest };
  if (repository && typeof repository === "object") {
    const repo = repository as Record<string, unknown>;
    safe.repository = { full_name: repo.full_name, html_url: repo.html_url };
  }
  if (sender && typeof sender === "object") {
    const s = sender as Record<string, unknown>;
    safe.sender = { login: s.login };
  }
  return safe;
}

export interface WebhookState {
  accept: string[];
  secret: string | undefined;
}

export function createWebhookRoutes(
  config: BotConfig,
  handler: WebhookHandler,
  isBusy: () => boolean,
): { app: Hono; state: WebhookState } {
  const app = new Hono();
  const state: WebhookState = {
    accept: [...(config.webhooks?.accept ?? [])],
    secret: config.webhooks?.secret,
  };

  if (!state.secret) {
    log.warn("Webhook secret not configured — payloads will be accepted without signature verification. Set webhooks.secret for production use.");
  }

  app.post("/webhook", async (c) => {
    // Payload size limit (check header as hint, enforce on body)
    const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }

    // Read secret from state each request (supports runtime updates)
    const currentSecret = state.secret;

    // Webhook signature verification (GitHub HMAC)
    if (currentSecret) {
      const signature = c.req.header("x-hub-signature-256");
      if (!signature) {
        return c.json({ error: "Missing signature" }, 401);
      }
      const body = await c.req.text();
      if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
        return c.json({ error: "Payload too large" }, 413);
      }
      const expected = "sha256=" + createHmac("sha256", currentSecret).update(body).digest("hex");
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
      return handlePayload(c, parsed);
    }

    // Enforce size limit even without HMAC secret
    const rawBody = await c.req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    return handlePayload(c, body);
  });

  async function handlePayload(c: Context, body: Record<string, unknown>) {
    // Extract event type
    let eventType: string;
    const githubEvent = c.req.header("x-github-event");
    if (githubEvent) {
      const action = (body.action as string) ?? "";
      eventType = action ? `${githubEvent}.${action}` : githubEvent;
    } else {
      eventType = (body.type as string) ?? "unknown";
    }

    // Check allowlist
    if (!state.accept.includes(eventType)) {
      return c.body(null, 204); // silently drop
    }

    // Busy check
    if (isBusy()) {
      c.header("Retry-After", "60");
      return c.json({ error: "Bot is busy" }, 429);
    }

    // Forward to handler with redacted payload
    const safePayload = safeExtractPayload(body);
    const prompt = `Webhook event: ${eventType}\n\nPayload:\n${JSON.stringify(safePayload, null, 2)}`;
    const accepted = await handler(prompt);
    if (accepted) {
      return c.json({ status: "accepted", event: eventType });
    }
    return c.json({ error: "Handler rejected" }, 500);
  }

  return { app, state };
}
