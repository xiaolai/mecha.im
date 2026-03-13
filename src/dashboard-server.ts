import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import * as docker from "./docker.js";
import { listBots as listRegistered } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import { addCredential, detectCredentialType, listCredentials, loadCredentials } from "./auth.js";
import { existsSync } from "node:fs";
import { isValidName } from "../shared/validation.js";
import { MechaError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import type { Context } from "hono";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-generate dashboard token if not set
const DASHBOARD_TOKEN = process.env.MECHA_DASHBOARD_TOKEN || ("mecha_dash_" + randomBytes(24).toString("hex"));
const DASHBOARD_COOKIE = "mecha_dashboard_session";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host",
]);

const spawnBodySchema = z.object({
  config_path: z.string().optional(),
  name: z.string().min(1).max(32).optional(),
  system: z.string().min(1).optional(),
  model: z.string().optional(),
  dir: z.string().optional(),
});

const authBodySchema = z.object({
  profile: z.string().min(1).max(32),
  key: z.string().min(1),
});

/** Check if a bot is currently busy by querying its /api/status endpoint.
 *  Returns `unknown: true` if status could not be determined (bot unreachable). */
async function checkBotBusy(name: string): Promise<{ busy: boolean; unknown?: boolean; state?: string }> {
  try {
    const resolved = await resolveHostBotBaseUrl(name, { allowRemote: false });
    if (!resolved) return { busy: false, unknown: true, state: "unreachable" };
    const botEntry = listRegistered()[name];
    const headers: Record<string, string> = {};
    if (botEntry?.botToken) headers["Authorization"] = `Bearer ${botEntry.botToken}`;
    const resp = await fetch(`${resolved.baseUrl}/api/status`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { busy: false, unknown: true, state: "unreachable" };
    const status = await resp.json() as { state?: string };
    const busyStates = ["thinking", "calling", "scheduled", "webhook"];
    return { busy: busyStates.includes(status.state ?? ""), state: status.state };
  } catch {
    return { busy: false, unknown: true, state: "unreachable" };
  }
}

function safeError(c: Context, err: unknown) {
  log.error("Dashboard API error", { error: err instanceof Error ? err.message : String(err) });
  if (err instanceof MechaError) {
    return c.json({ error: err.message }, err.statusCode as 400);
  }
  return c.json({ error: "Internal server error" }, 500);
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const cookie of cookies) {
    const eq = cookie.indexOf("=");
    if (eq === -1) continue;
    const key = cookie.slice(0, eq).trim();
    if (key === name) return cookie.slice(eq + 1);
  }
  return undefined;
}

function dashboardSessionCookie(): string {
  return `${DASHBOARD_COOKIE}=${DASHBOARD_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function hasDashboardAccess(c: Context): boolean {
  const auth = c.req.header("authorization");
  if (auth && constantTimeEquals(auth, `Bearer ${DASHBOARD_TOKEN}`)) return true;
  const cookie = readCookie(c.req.header("cookie"), DASHBOARD_COOKIE);
  return cookie !== undefined && constantTimeEquals(cookie, DASHBOARD_TOKEN);
}

function shouldBootstrapDashboardSession(c: Context): boolean {
  if (!(c.req.method === "GET" || c.req.method === "HEAD")) return false;
  if (c.req.path.startsWith("/api/")) return false;
  return readCookie(c.req.header("cookie"), DASHBOARD_COOKIE) !== DASHBOARD_TOKEN;
}

export function startDashboardServer(port: number) {
  const app = new Hono();

  // CORS — only allow same-origin
  app.use("/*", cors({ origin: `http://localhost:${port}` }));

  app.use("/*", async (c, next) => {
    await next();
    if (shouldBootstrapDashboardSession(c)) {
      c.header("Set-Cookie", dashboardSessionCookie());
    }
  });

  // Auth middleware for all API and proxy routes (token always required)
  app.use("/api/*", async (c, next) => {
    if (!hasDashboardAccess(c)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.use("/bot/*", async (c, next) => {
    if (!hasDashboardAccess(c)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // --- Fleet API ---

  app.get("/api/bots", async (c) => {
    const bots = await docker.list();
    return c.json(bots);
  });

  app.get("/api/session", (c) => {
    return c.json({ authenticated: true });
  });

  app.post("/api/bots", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);

    const parsed = spawnBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body" }, 400);
    }

    try {
      let config;
      if (parsed.data.config_path) {
        // Restrict config_path to home directory (follow symlinks to prevent bypass)
        const home = process.env.HOME;
        if (!home) {
          return c.json({ error: "HOME not set" }, 500);
        }
        let absPath: string;
        try {
          absPath = realpathSync(resolve(parsed.data.config_path));
        } catch {
          return c.json({ error: "config_path not found" }, 400);
        }
        if (absPath !== home && !absPath.startsWith(home + "/")) {
          return c.json({ error: "config_path must be under your home directory" }, 400);
        }
        config = loadBotConfig(absPath);
      } else if (parsed.data.name && parsed.data.system) {
        config = buildInlineConfig({
          name: parsed.data.name,
          system: parsed.data.system,
          model: parsed.data.model,
        });
      } else {
        return c.json({ error: "Provide config_path or name+system" }, 400);
      }

      const dir = parsed.data.dir ? resolve(parsed.data.dir) : undefined;
      const containerId = await docker.spawn(config, dir);
      return c.json({ status: "spawned", name: config.name, containerId: containerId.slice(0, 12) });
    } catch (err) {
      return safeError(c, err);
    }
  });

  app.delete("/api/bots/:name", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    try {
      await docker.remove(name);
      return c.json({ status: "removed", name });
    } catch (err) {
      return safeError(c, err);
    }
  });

  app.post("/api/bots/:name/stop", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);

    // Check busy state unless force=true
    const force = c.req.query("force") === "true";
    if (!force) {
      const { busy, unknown, state } = await checkBotBusy(name);
      if (busy || unknown) {
        return c.json({
          error: unknown ? "Bot status unknown — use force=true to proceed" : "Bot is busy",
          code: unknown ? "BOT_STATUS_UNKNOWN" : "BOT_BUSY",
          state,
        }, 409);
      }
    }

    try {
      await docker.stop(name);
      return c.json({ status: "stopped", name });
    } catch (err) {
      return safeError(c, err);
    }
  });

  app.post("/api/bots/:name/restart", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);

    // Check busy state unless force=true
    const force = c.req.query("force") === "true";
    if (!force) {
      const { busy, unknown, state } = await checkBotBusy(name);
      if (busy || unknown) {
        return c.json({
          error: unknown ? "Bot status unknown — use force=true to proceed" : "Bot is busy",
          code: unknown ? "BOT_STATUS_UNKNOWN" : "BOT_BUSY",
          state,
        }, 409);
      }
    }

    try {
      const containerId = await docker.restart(name);
      return c.json({ status: "restarted", name, containerId: containerId.slice(0, 12) });
    } catch (err) {
      return safeError(c, err);
    }
  });

  // --- Per-bot auth API ---

  app.get("/api/bots/:name/auth", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);

    const entry = listRegistered()[name];
    if (!entry?.config) return c.json({ error: "Bot not found" }, 404);

    // Read the bot's config to find its auth profile
    let botAuth: string | undefined;
    try {
      const config = loadBotConfig(entry.config);
      botAuth = config.auth;
    } catch { /* ignore parse errors */ }

    // List available Claude auth profiles
    const creds = loadCredentials();
    const claudeProfiles = creds
      .filter((cr) => cr.type === "api_key" || cr.type === "oauth_token")
      .map((cr) => ({ name: cr.name, type: cr.type }));

    return c.json({
      current_profile: botAuth ?? null,
      profiles: claudeProfiles,
    });
  });

  app.put("/api/bots/:name/auth", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.profile !== "string") {
      return c.json({ error: "profile is required" }, 400);
    }
    const profile = body.profile as string;

    // Verify the profile exists and is a Claude auth type
    const creds = loadCredentials();
    const cred = creds.find((cr) => cr.name === profile);
    if (!cred) return c.json({ error: `Profile "${profile}" not found` }, 404);
    if (cred.type !== "api_key" && cred.type !== "oauth_token") {
      return c.json({ error: `Profile "${profile}" is not a Claude auth credential` }, 400);
    }

    const entry = listRegistered()[name];
    if (!entry?.config) return c.json({ error: "Bot not found" }, 404);

    // Check busy state BEFORE mutating config
    const force = c.req.query("force") === "true";
    if (!force) {
      const { busy, unknown, state } = await checkBotBusy(name);
      if (busy || unknown) {
        return c.json({
          error: unknown ? "Bot status unknown — use force=true to proceed" : "Bot is busy",
          code: unknown ? "BOT_STATUS_UNKNOWN" : "BOT_BUSY",
          state,
          profile,
        }, 409);
      }
    }

    // Update the bot's config file
    try {
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");
      const raw = readFileSync(entry.config, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      parsed.auth = profile;
      writeFileSync(entry.config, stringifyYaml(parsed), { mode: 0o600 });
    } catch (err) {
      return c.json({ error: "Failed to update bot config" }, 500);
    }

    // Restart the bot to pick up new auth
    try {
      const containerId = await docker.restart(name);
      return c.json({ status: "switched", profile, containerId: containerId.slice(0, 12) });
    } catch (err) {
      return safeError(c, err);
    }
  });

  // --- Auth API ---

  app.get("/api/auth", (c) => {
    return c.json(listCredentials().map((c) => c.name));
  });

  app.post("/api/auth", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = authBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "profile and key required" }, 400);
    }
    const detected = detectCredentialType(parsed.data.key);
    addCredential({ name: parsed.data.profile, ...detected, key: parsed.data.key });
    return c.json({ status: "added", profile: parsed.data.profile });
  });

  // --- Network: aggregate logs from all bots (parallel) ---

  app.get("/api/network", async (c) => {
    const bots = await docker.list();
    const runningBots = bots.filter((b) => b.status === "running");

    const results = await Promise.allSettled(
      runningBots.map(async (bot) => {
        const resolved = await resolveHostBotBaseUrl(bot.name, { allowRemote: false });
        if (!resolved) return [];
        const botEntry = listRegistered()[bot.name];
        const fetchHeaders: Record<string, string> = {};
        if (botEntry?.botToken) fetchHeaders["Authorization"] = `Bearer ${botEntry.botToken}`;
        const resp = await fetch(`${resolved.baseUrl}/api/logs?limit=50`, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok) return [];
        const logs = await resp.json() as Record<string, unknown>[];
        return logs.map((e) => ({ ...e, source_bot: bot.name }));
      }),
    );

    const events: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") events.push(...r.value);
    }

    return c.json(events);
  });

  // --- Proxy to individual bot dashboard ---

  app.all("/bot/:name/*", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);

    const resolved = await resolveHostBotBaseUrl(name, { allowRemote: false });
    if (!resolved) return c.json({ error: `Bot "${name}" not reachable` }, 502);

    const rawPath = c.req.path.replace(`/bot/${name}`, "") || "/";
    // Decode and normalize to catch encoded traversal variants (%2e%2e, etc.)
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return c.json({ error: "Invalid path encoding" }, 400);
    }
    if (path.includes("..") || path.includes("\0")) return c.json({ error: "Invalid path" }, 400);
    const url = new URL(c.req.url);
    const targetUrl = `${resolved.baseUrl}${path}${url.search}`;

    // Filter headers: remove hop-by-hop and sensitive headers, inject bot token
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "authorization") {
        forwardHeaders[key] = value;
      }
    }
    const botEntry = listRegistered()[name];
    if (botEntry?.botToken) {
      forwardHeaders["Authorization"] = `Bearer ${botEntry.botToken}`;
    }

    try {
      const resp = await fetch(targetUrl, {
        method: c.req.method,
        headers: forwardHeaders,
        body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });

      // Filter response headers
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of resp.headers.entries()) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      }

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return c.json({ error: "Proxy error" }, 502);
    }
  });

  // --- Serve static fleet dashboard ---
  const staticRoot = join(__dirname, "..", "dashboard", "dist");
  if (existsSync(staticRoot)) {
    app.use("/*", serveStatic({ root: staticRoot }));
  } else {
    app.get("/", (c) => c.json({
      message: "Mecha Fleet Dashboard API",
      routes: ["/api/bots", "/api/auth", "/api/network", "/bot/:name/*"],
    }));
  }

  const hostname = process.env.MECHA_DASHBOARD_HOST ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    console.log(`Mecha dashboard running at http://${hostname}:${port}`);
    if (!process.env.MECHA_DASHBOARD_TOKEN) {
      console.log(`Dashboard token (auto-generated): ${DASHBOARD_TOKEN.slice(0, 16)}...`);
    }
  });

  return server;
}
