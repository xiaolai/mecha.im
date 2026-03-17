import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as docker from "./docker.js";
import { withBotLock } from "./docker.utils.js";
import { listBots as listRegistered } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import { addCredential, detectCredentialType, listCredentials, loadCredentials } from "./auth.js";
import { existsSync, readFileSync as fsReadFileSync, realpathSync, statSync } from "node:fs";
import { isValidName } from "../shared/validation.js";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";
import { DASHBOARD_TOKEN, HOP_BY_HOP, spawnBodySchema, authBodySchema, totpVerifySchema, revokeAllSessions, isValidSession } from "./dashboard-server-schema.js";
import { safeError, dashboardSessionCookie, hasDashboardAccess, shouldBootstrapDashboardSession, guardBusy } from "./dashboard-server-utils.js";
import { getTotpSecret, setTotpSecret, clearTotpSecret, getMechaDir, getOrCreateFleetInternalSecret } from "./store.js";
import { timingSafeEqual, createHmac as cryptoHmac } from "node:crypto";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { generateSecret, verifyTOTP, totpUri } from "../shared/totp.js";
import { atomicWriteJsonAsync } from "../shared/atomic-write.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startDashboardServer(port: number, host?: string) {
  const app = new Hono();

  // CORS — only allow same-origin
  app.use("/*", cors({ origin: `http://localhost:${port}` }));

  app.use("/*", async (c, next) => {
    await next();
    if (shouldBootstrapDashboardSession(c)) {
      c.header("Set-Cookie", dashboardSessionCookie());
    }
  });

  // --- TOTP (unauthenticated) ---
  // Health endpoint (unauthenticated)
  const daemonStartedAt = Date.now();
  // Read version once at startup from package.json
  let _version = "unknown";
  try {
    _version = JSON.parse(fsReadFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf-8")).version ?? "unknown";
  } catch { /* best-effort */ }

  app.get("/api/health", async (c) => {
    let running = 0, stopped = 0;
    try {
      const bots = await docker.list();
      running = bots.filter(b => b.status === "running").length;
      stopped = bots.length - running;
    } catch { /* Docker may be unavailable */ }
    return c.json({
      status: "ok",
      version: _version,
      uptime: Math.floor((Date.now() - daemonStartedAt) / 1000),
      bots: { running, stopped },
      pid: process.pid,
    });
  });

  app.get("/api/totp/status", (c) => {
    return c.json({ enabled: !!getTotpSecret() });
  });

  // TOTP rate limiting: max 5 attempts per 60 seconds per IP
  const totpAttempts = new Map<string, { count: number; resetAt: number }>();
  const TOTP_MAX_ATTEMPTS = 5;
  const TOTP_WINDOW_MS = 60_000;

  app.post("/api/totp/verify", async (c) => {
    const secret = getTotpSecret();
    if (!secret) return c.json({ error: "TOTP not enabled" }, 400);

    // Rate limit by IP
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const now = Date.now();
    let entry = totpAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + TOTP_WINDOW_MS };
      totpAttempts.set(ip, entry);
    }
    entry.count++;
    if (entry.count > TOTP_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = totpVerifySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid code format" }, 400);

    if (!verifyTOTP(secret, parsed.data.code)) {
      return c.json({ error: "Invalid code" }, 401);
    }

    // Success — reset rate limit and set session cookie
    totpAttempts.delete(ip);
    c.header("Set-Cookie", dashboardSessionCookie());
    return c.json({ authenticated: true });
  });

  // Auth middleware for all API and proxy routes (token always required)
  app.use("/api/*", async (c, next) => {
    // Allow TOTP status/verify through without auth
    if (c.req.path === "/api/health" || c.req.path === "/api/totp/status" || c.req.path === "/api/totp/verify" || c.req.path.startsWith("/api/fleet/")) {
      return next();
    }
    // Allow public read-only access to office layout, stream, and avatars
    if (
      (c.req.path === "/api/office/layout" && c.req.method === "GET") ||
      (c.req.path === "/api/office/stream" && c.req.method === "GET") ||
      (c.req.path === "/api/office/avatars" && c.req.method === "GET")
    ) {
      return next();
    }
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

  // --- Fleet Internal API (authenticated with MECHA_FLEET_INTERNAL_SECRET) ---
  app.use("/api/fleet/*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
    const token = auth.slice(7);
    const secret = getOrCreateFleetInternalSecret();
    const bufA = Buffer.from(token);
    const bufB = Buffer.from(secret);
    if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.get("/api/fleet/bots", async (c) => {
    const bots = await docker.list();
    return c.json(bots);
  });

  app.post("/api/fleet/bots", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name || !body?.system) return c.json({ error: "name and system required" }, 400);
    const config = buildInlineConfig({ name: body.name, system: body.system, model: body.model });
    if (body.auth) config.auth = body.auth;
    const containerId = await docker.spawn(config);
    return c.json({ status: "spawned", name: config.name, containerId: containerId.slice(0, 12) });
  });

  app.post("/api/fleet/bots/:name/start", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    await docker.start(name);
    return c.json({ status: "started", name });
  });

  app.post("/api/fleet/bots/:name/stop", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    await docker.stop(name);
    return c.json({ status: "stopped", name });
  });

  app.post("/api/fleet/bots/:name/restart", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    const containerId = await docker.restart(name);
    return c.json({ status: "restarted", name, containerId: containerId.slice(0, 12) });
  });

  app.delete("/api/fleet/bots/:name", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    await docker.remove(name);
    return c.json({ status: "removed", name });
  });

  app.get("/api/fleet/bots/:name/config", async (c) => {
    const name = c.req.param("name");
    if (!isValidName(name)) return c.json({ error: "Invalid bot name" }, 400);
    const entry = listRegistered()[name];
    if (!entry?.config) return c.json({ error: "Bot not found" }, 404);
    try {
      const { readFileSync } = await import("node:fs");
      const { parse: parseYaml } = await import("yaml");
      const raw = readFileSync(entry.config, "utf-8");
      const config = parseYaml(raw);
      const field = new URL(c.req.url).searchParams.get("field");
      if (field) return c.json({ [field]: config[field] });
      return c.json(config);
    } catch { return c.json({ error: "Failed to read config" }, 500); }
  });

  app.get("/api/fleet/costs", async (c) => {
    const bots = listRegistered();
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(bots)) {
      if (!entry.path) continue;
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        result[name] = JSON.parse(readFileSync(join(entry.path, "costs.json"), "utf-8"));
      } catch { result[name] = {}; }
    }
    return c.json(result);
  });

  app.get("/api/fleet/costs/:name", async (c) => {
    const name = c.req.param("name");
    const entry = listRegistered()[name];
    if (!entry?.path) return c.json({ error: "Bot not found" }, 404);
    try {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      return c.json(JSON.parse(readFileSync(join(entry.path, "costs.json"), "utf-8")));
    } catch { return c.json({}); }
  });

  app.get("/api/fleet/health", async (c) => {
    const bots = await docker.list();
    const running = bots.filter(b => b.status === "running").length;
    return c.json({
      status: "ok",
      version: _version,
      uptime: Math.floor((Date.now() - daemonStartedAt) / 1000),
      bots: { running, stopped: bots.length - running },
      pid: process.pid,
    });
  });

  // --- Dashboard Fleet API (dashboard auth) ---
  app.get("/api/bots", async (c) => {
    const bots = await docker.list();
    return c.json(bots);
  });

  app.get("/api/session", (c) => c.json({ authenticated: true }));

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

    const blocked = await guardBusy(c, name);
    if (blocked) return blocked;

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

    const blocked = await guardBusy(c, name);
    if (blocked) return blocked;

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
    const blocked = await guardBusy(c, name, { profile });
    if (blocked) return blocked;

    // Update config and restart under bot lock to prevent concurrent mutations
    try {
      const result = await withBotLock(name, async () => {
        const { readFileSync } = await import("node:fs");
        const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");
        const configPath = entry.config!;
        const raw = readFileSync(configPath, "utf-8");
        const parsed = parseYaml(raw) as Record<string, unknown>;
        parsed.auth = profile;
        await atomicWriteJsonAsync(configPath, stringifyYaml(parsed));
        const containerId = await docker.restart(name);
        return { status: "switched" as const, profile, containerId: containerId.slice(0, 12) };
      });
      return c.json(result);
    } catch (err) {
      return safeError(c, err);
    }
  });

  // --- Auth API ---
  app.get("/api/auth", (c) => c.json(listCredentials().map((c) => c.name)));

  app.post("/api/auth", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = authBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "profile and key required" }, 400);
    }
    if (!isValidName(parsed.data.profile)) {
      return c.json({ error: "Invalid profile name" }, 400);
    }
    const detected = detectCredentialType(parsed.data.key);
    addCredential({ name: parsed.data.profile, ...detected, key: parsed.data.key });
    return c.json({ status: "added", profile: parsed.data.profile });
  });

  // --- TOTP management (authenticated) ---
  app.post("/api/totp/enable", (c) => {
    if (getTotpSecret()) return c.json({ error: "TOTP already enabled" }, 400);
    const secret = generateSecret();
    setTotpSecret(secret);
    revokeAllSessions(); // invalidate all existing sessions when auth settings change
    const uri = totpUri(secret, "Mecha", "dashboard");
    return c.json({ secret, uri });
  });

  app.delete("/api/totp", async (c) => {
    const secret = getTotpSecret();
    if (!secret) return c.json({ error: "TOTP not enabled" }, 400);

    // Require a valid code to disable
    const body = await c.req.json().catch(() => null);
    const parsed = totpVerifySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Code required to disable TOTP" }, 400);

    if (!verifyTOTP(secret, parsed.data.code)) {
      return c.json({ error: "Invalid code" }, 401);
    }

    clearTotpSecret();
    revokeAllSessions(); // invalidate all sessions when TOTP is disabled
    return c.json({ disabled: true });
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

    // Filter headers: remove hop-by-hop, auth, and cookie headers to prevent token leakage
    const STRIP_REQUEST = new Set([...HOP_BY_HOP, "authorization", "cookie"]);
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!STRIP_REQUEST.has(key.toLowerCase())) {
        forwardHeaders[key] = value;
      }
    }
    const botEntry = listRegistered()[name];
    if (botEntry?.botToken) {
      forwardHeaders["Authorization"] = `Bearer ${botEntry.botToken}`;
    }

    try {
      const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
      const fetchOpts: RequestInit & { duplex?: string } = {
        method: c.req.method,
        headers: forwardHeaders,
        body: hasBody ? c.req.raw.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(5 * 60 * 1000), // 5min for SSE streams
      };
      if (hasBody) fetchOpts.duplex = "half";
      const resp = await fetch(targetUrl, fetchOpts);

      // Filter response headers: strip hop-by-hop and set-cookie to prevent bot planting cookies on fleet origin
      const STRIP_RESPONSE = new Set([...HOP_BY_HOP, "set-cookie"]);
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of resp.headers.entries()) {
        if (!STRIP_RESPONSE.has(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      }

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (err) {
      console.error("Proxy error:", targetUrl, err instanceof Error ? err.message : String(err));
      return c.json({ error: "Proxy error" }, 502);
    }
  });

  // --- Office Layout API ---
  app.get("/api/office/layout", (c) => {
    const layoutPath = join(getMechaDir(), "office-layout.json");
    if (!existsSync(layoutPath)) {
      return c.json({ error: "No layout" }, 404);
    }
    try {
      const content = fsReadFileSync(layoutPath, "utf-8");
      const etag = createHash("md5").update(content).digest("hex");
      c.header("ETag", `"${etag}"`);
      return c.json(JSON.parse(content));
    } catch {
      return c.json({ error: "Failed to read or parse layout file" }, 500);
    }
  });

  app.post("/api/office/layout", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);

    if (
      body.version !== 1 ||
      !Array.isArray(body.tiles) ||
      typeof body.cols !== "number" ||
      typeof body.rows !== "number" ||
      body.cols <= 0 ||
      body.rows <= 0 ||
      !Number.isInteger(body.cols) ||
      !Number.isInteger(body.rows)
    ) {
      return c.json({ error: "Invalid layout: must have version=1, tiles array, cols>0, rows>0" }, 400);
    }
    // Enforce reasonable dimension limits and structural consistency
    if (body.cols > 64 || body.rows > 64) {
      return c.json({ error: "Layout dimensions too large (max 64x64)" }, 400);
    }
    if (body.tiles.length !== body.cols * body.rows) {
      return c.json({ error: `tiles.length (${body.tiles.length}) must equal cols*rows (${body.cols * body.rows})` }, 400);
    }
    if (body.tileColors && Array.isArray(body.tileColors) && body.tileColors.length !== body.tiles.length) {
      return c.json({ error: "tileColors.length must match tiles.length" }, 400);
    }
    if (body.furniture && !Array.isArray(body.furniture)) {
      return c.json({ error: "furniture must be an array" }, 400);
    }

    const layoutPath = join(getMechaDir(), "office-layout.json");
    const ifMatch = c.req.header("If-Match");
    if (ifMatch) {
      if (!existsSync(layoutPath)) {
        return c.json({ error: "Conflict: layout does not exist" }, 409);
      }
      const current = fsReadFileSync(layoutPath, "utf-8");
      const currentEtag = `"${createHash("md5").update(current).digest("hex")}"`;
      if (ifMatch !== currentEtag) {
        return c.json({ error: "Conflict: ETag mismatch" }, 409);
      }
    }

    await atomicWriteJsonAsync(layoutPath, body);
    const written = fsReadFileSync(layoutPath, "utf-8");
    const newEtag = `"${createHash("md5").update(written).digest("hex")}"`;
    c.header("ETag", newEtag);
    return c.json({ status: "saved" });
  });

  // --- Office Avatars API ---
  const avatarsFile = () => join(getMechaDir(), "office-avatars.json");

  function readAvatars(): Record<string, { palette: number; hueShift: number; displayName: string }> {
    const p = avatarsFile();
    if (!existsSync(p)) return {};
    try {
      const raw = JSON.parse(fsReadFileSync(p, "utf-8")) as Record<string, unknown>;
      const result: Record<string, { palette: number; hueShift: number; displayName: string }> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (val && typeof val === "object") {
          const v = val as Record<string, unknown>;
          if (typeof v.palette === "number" && typeof v.hueShift === "number" && typeof v.displayName === "string") {
            result[key] = { palette: v.palette, hueShift: v.hueShift, displayName: v.displayName };
          }
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  app.get("/api/office/avatars", (c) => {
    return c.json(readAvatars());
  });

  app.post("/api/office/avatars", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);

    const { name, palette, hueShift, displayName } = body as Record<string, unknown>;

    // Validate name
    if (typeof name !== "string" || !isValidName(name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }

    // Validate palette: integer 0-5
    if (typeof palette !== "number" || !Number.isInteger(palette) || palette < 0 || palette > 5) {
      return c.json({ error: "palette must be an integer 0-5" }, 400);
    }

    // Validate hueShift: integer 0-359
    if (typeof hueShift !== "number" || !Number.isInteger(hueShift) || hueShift < 0 || hueShift > 359) {
      return c.json({ error: "hueShift must be an integer 0-359" }, 400);
    }

    // Validate displayName: string 1-32 chars, strip control chars
    if (typeof displayName !== "string") {
      return c.json({ error: "displayName must be a string" }, 400);
    }
    // eslint-disable-next-line no-control-regex
    const cleaned = displayName.replace(/[\x00-\x1f\x7f]/g, "").trim();
    if (cleaned.length < 1 || cleaned.length > 32) {
      return c.json({ error: "displayName must be 1-32 characters after stripping control chars" }, 400);
    }

    // Read-merge-write atomically
    const avatars = readAvatars();
    avatars[name] = { palette, hueShift, displayName: cleaned };
    try {
      await atomicWriteJsonAsync(avatarsFile(), avatars);
    } catch {
      return c.json({ error: "Failed to write avatar config" }, 500);
    }

    return c.json({ status: "saved" });
  });

  // --- Fleet Office SSE Stream ---
  app.get("/api/office/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      let seq = 0;
      const knownBots = new Map<string, string>(); // containerId → name
      let closed = false;
      let lastAvatarMtime = 0; // track avatar file changes

      async function sendSnapshot() {
        const bots = await docker.list();
        const running = bots.filter(b => b.status === "running");
        const avatars = readAvatars();
        const snapshot = running.map(b => {
          // Use truncated container ID (first 12 chars) — avoids exposing full ID on public endpoint
          const entry: Record<string, unknown> = { bot_id: b.containerId.slice(0, 12), name: b.name, status: "idle" as const };
          const av = avatars[b.name];
          if (av) {
            entry.palette = av.palette;
            entry.hueShift = av.hueShift;
            entry.displayName = av.displayName;
          }
          return entry;
        });
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ seq: seq++, bots: snapshot }) });
        knownBots.clear();
        for (const b of running) knownBots.set(b.containerId, b.name);
        // Track avatar file mtime
        try { lastAvatarMtime = statSync(avatarsFile()).mtimeMs; } catch { lastAvatarMtime = 0; }
      }

      await sendSnapshot();

      const pollInterval = setInterval(async () => {
        if (closed) return;
        try {
          const bots = await docker.list();
          const running = new Map(bots.filter(b => b.status === "running").map(b => [b.containerId, b.name] as const));

          for (const [id, name] of running) {
            if (!knownBots.has(id)) {
              knownBots.set(id, name);
              const avatars = readAvatars();
              const av = avatars[name];
              const joinData: Record<string, unknown> = { seq: seq++, type: "bot_join", bot_id: id, name };
              if (av) {
                joinData.palette = av.palette;
                joinData.hueShift = av.hueShift;
                joinData.displayName = av.displayName;
              }
              await stream.writeSSE({ event: "state", data: JSON.stringify(joinData) });
            }
          }

          for (const [id] of knownBots) {
            if (!running.has(id)) {
              knownBots.delete(id);
              await stream.writeSSE({ event: "state", data: JSON.stringify({ seq: seq++, type: "bot_leave", bot_id: id }) });
            }
          }

          // Detect avatar file changes and resend snapshot
          let currentMtime = 0;
          try { currentMtime = statSync(avatarsFile()).mtimeMs; } catch { /* file may not exist */ }
          if (currentMtime > 0 && currentMtime !== lastAvatarMtime) {
            lastAvatarMtime = currentMtime;
            await sendSnapshot();
          }
        } catch { /* ignore polling errors */ }
      }, 5000);

      const heartbeatInterval = setInterval(async () => {
        if (closed) return;
        try {
          await stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ seq: seq++ }) });
        } catch { /* connection closed */ }
      }, 15000);

      // Keep stream alive until client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          closed = true;
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          resolve();
        });
      });
    });
  });

  // --- Serve unified dashboard (from agent/dashboard/dist) ---
  const staticRoot = join(__dirname, "..", "agent", "dashboard", "dist");
  if (existsSync(staticRoot)) {
    app.use("/*", serveStatic({ root: staticRoot }));
    // SPA fallback: serve index.html for non-file, non-API routes
    const indexPath = join(staticRoot, "index.html");
    const cachedIndexHtml = existsSync(indexPath) ? fsReadFileSync(indexPath, "utf-8") : null;
    app.get("*", (c) => {
      const path = c.req.path;
      if (path.startsWith("/api/") || path.startsWith("/bot/")) {
        return c.json({ error: "Not found" }, 404);
      }
      if (cachedIndexHtml) {
        return c.html(cachedIndexHtml);
      }
      return c.json({ error: "Dashboard not built" }, 404);
    });
  } else {
    app.get("/", (c) => c.json({
      message: "Mecha Fleet Dashboard API",
      routes: ["/api/bots", "/api/auth", "/api/network", "/bot/:name/*"],
    }));
  }

  const hostname = host ?? process.env.MECHA_DASHBOARD_HOST ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    console.log(`Mecha dashboard running at http://${hostname}:${port}`);
    if (!process.env.MECHA_DASHBOARD_TOKEN) {
      console.log(`Dashboard token (auto-generated): ${DASHBOARD_TOKEN.slice(0, 16)}...`);
    }
  });

  // --- WebSocket proxy for PTY terminal ---
  // Proxies /bot/:name/ws/terminal → container's /ws/terminal
  {
    const proxyWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", async (req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const match = url.pathname.match(/^\/bot\/([a-z0-9][a-z0-9-]*)\/ws\/(.+)$/);
      if (!match) {
        socket.destroy();
        return;
      }

      const botName = match[1];
      const wsPath = `/ws/${match[2]}`;

      // Auth: check fleet dashboard session cookie
      const cookieHeader = req.headers.cookie ?? "";
      const sessionMatch = cookieHeader.match(/mecha_dashboard_session=([^;]+)/);
      const sessionToken = sessionMatch?.[1];
      if (!sessionToken || (!isValidSession(sessionToken!) && sessionToken !== DASHBOARD_TOKEN)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Resolve bot endpoint
      const resolved = await resolveHostBotBaseUrl(botName, { allowRemote: false });
      if (!resolved) {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
        return;
      }

      // Build bot auth cookie (HMAC of bot token)
      const botEntry = listRegistered()[botName];
      if (!botEntry?.botToken) {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
        return;
      }
      const botAuthToken = cryptoHmac("sha256", botEntry.botToken).update("mecha-dashboard-session").digest("hex");

      // Connect upstream WebSocket to bot container
      const targetUrl = resolved.baseUrl.replace(/^http/, "ws") + `${wsPath}${url.search}`;
      const upstream = new WsClient(targetUrl, {
        headers: { cookie: `mecha_session=${botAuthToken}` },
      });

      upstream.on("unexpected-response", (_req, res) => {
        socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n\r\n`);
        socket.destroy();
      });

      upstream.on("error", () => { socket.destroy(); });

      upstream.on("open", () => {
        proxyWss.handleUpgrade(req, socket, head, (clientWs) => {
          // Pipe frames bidirectionally
          clientWs.on("message", (data, isBinary) => {
            if (upstream.readyState === WsClient.OPEN) upstream.send(data, { binary: isBinary });
          });
          upstream.on("message", (data, isBinary) => {
            if (clientWs.readyState === WsClient.OPEN) clientWs.send(data, { binary: isBinary as boolean });
          });

          clientWs.on("close", () => upstream.close());
          upstream.on("close", () => clientWs.close());
          clientWs.on("error", () => upstream.close());
          upstream.on("error", () => clientWs.close());

          // Proxy ping/pong
          upstream.on("ping", (data) => clientWs.ping(data));
          upstream.on("pong", (data) => clientWs.pong(data));
          clientWs.on("ping", (data) => upstream.ping(data));
          clientWs.on("pong", (data) => upstream.pong(data));
        });
      });
    });
  }

  return server;
}
