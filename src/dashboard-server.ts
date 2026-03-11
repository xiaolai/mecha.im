import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import * as docker from "./docker.js";
import { listBots as listRegistered } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import { addAuthProfile, listAuthProfiles } from "./auth.js";
import { existsSync } from "node:fs";
import { isValidName } from "../shared/validation.js";
import { MechaError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import type { Context } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-generate dashboard token if not set
const DASHBOARD_TOKEN = process.env.MECHA_DASHBOARD_TOKEN || ("mecha_dash_" + randomBytes(24).toString("hex"));

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

function safeError(c: Context, err: unknown) {
  log.error("Dashboard API error", { error: err instanceof Error ? err.message : String(err) });
  if (err instanceof MechaError) {
    return c.json({ error: err.message }, err.statusCode as 400);
  }
  return c.json({ error: "Internal server error" }, 500);
}

export function startDashboardServer(port: number) {
  const app = new Hono();

  // CORS — only allow same-origin
  app.use("/*", cors({ origin: `http://localhost:${port}` }));

  // Auth middleware for all API and proxy routes (token always required)
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${DASHBOARD_TOKEN}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.use("/bot/*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${DASHBOARD_TOKEN}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // --- Fleet API ---

  app.get("/api/bots", async (c) => {
    const bots = await docker.list();
    return c.json(bots);
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
    try {
      await docker.stop(name).catch((err) => {
        // Only ignore "not running" errors; propagate real failures
        if (!(err instanceof MechaError && err.code === "BOT_NOT_RUNNING")) {
          throw err;
        }
      });
      const entry = listRegistered()[name];
      if (!entry?.config) return c.json({ error: "No saved config" }, 404);
      const config = loadBotConfig(entry.config);
      const containerId = await docker.spawn(config, entry.path);
      return c.json({ status: "restarted", name, containerId: containerId.slice(0, 12) });
    } catch (err) {
      return safeError(c, err);
    }
  });

  // --- Auth API ---

  app.get("/api/auth", (c) => {
    return c.json(listAuthProfiles());
  });

  app.post("/api/auth", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = authBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "profile and key required" }, 400);
    }
    addAuthProfile(parsed.data.profile, parsed.data.key);
    return c.json({ status: "added", profile: parsed.data.profile });
  });

  // --- Network: aggregate logs from all bots (parallel) ---

  app.get("/api/network", async (c) => {
    const bots = await docker.list();
    const runningBots = bots.filter((b) => b.status === "running");

    const results = await Promise.allSettled(
      runningBots.map(async (bot) => {
        const ip = await docker.getContainerIp(bot.name);
        if (!ip) return [];
        const botEntry = listRegistered()[bot.name];
        const fetchHeaders: Record<string, string> = {};
        if (botEntry?.botToken) fetchHeaders["Authorization"] = `Bearer ${botEntry.botToken}`;
        const resp = await fetch(`http://${ip}:3000/api/logs?limit=50`, {
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

    const ip = await docker.getContainerIp(name);
    if (!ip) return c.json({ error: `Bot "${name}" not reachable` }, 502);

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
    const targetUrl = `http://${ip}:3000${path}${url.search}`;

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
      console.log(`Dashboard token (auto-generated): ${DASHBOARD_TOKEN}`);
    }
  });

  return server;
}
