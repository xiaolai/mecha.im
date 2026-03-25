/**
 * Agent HTTP server — receives bot queries from local CLI and remote mesh nodes.
 *
 * Routes:
 * - GET  /healthz                  — liveness check (no auth)
 * - GET  /bots                     — list local bots (for mesh discovery)
 * - POST /bots/:botName/query      — forward a query to a local bot
 * - GET  /acl                      — ACL rules
 * - GET  /models                   — available Claude models
 * - GET  /node/info                — host node information
 * - GET  /mesh/nodes               — mesh node list
 * - GET  /settings/totp            — TOTP auth status
 * - GET  /settings/runtime         — runtime settings
 * - GET  /settings/network         — network settings
 * - GET  /settings/auth-profiles   — auth profiles
 * - GET  /schedules                — aggregate bot schedules
 * - GET  /budgets                  — budget configuration
 * - GET  /meter/cost               — today's metered cost
 * - GET  /meter/status             — meter proxy status
 * - GET  /audit                    — audit log (placeholder)
 * - GET  /events/log               — event log (placeholder)
 * - GET  /tools                    — MCP tools (placeholder)
 * - GET  /tools/runtime            — runtime tool info (placeholder)
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import {
  isValidName,
  readBotConfig,
  forwardQueryToBot,
} from "@mecha/core";
import type { AclEngine, Capability } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { createAuthHook, createAuthContext, verifyRequestSignature } from "./auth.js";
import type { AuthConfig } from "./auth.js";
import { registerTaskRoutes } from "./task-routes.js";

export interface AgentServerOptions {
  port: number;
  auth: AuthConfig;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
  startedAt?: string;
  publicIp?: string;
  /** PTY spawn function — stored for future terminal routes. */
  ptySpawnFn?: unknown;
  /** Path to built SPA assets. When set, registers @fastify/static (resolved from caller's node_modules). */
  spaDir?: string;
}

interface QueryBody {
  message: string;
  sessionId?: string;
  requestId?: string;
}

/**
 * Create and configure the agent Fastify server.
 * Returns an unstarted Fastify instance — call .listen() to bind.
 */
export function createAgentServer(opts: AgentServerOptions): FastifyInstance {
  const { auth, acl, mechaDir } = opts;
  const authCtx = createAuthContext(auth, mechaDir);

  const app = Fastify({ logger: false });

  // Auth hook — validates session cookie on all routes except /healthz
  app.addHook("preHandler", createAuthHook(authCtx));

  // Health check
  app.get("/healthz", async () => ({ status: "ok" }));

  // Auth routes (must be accessible without auth — skipped by auth hook via /auth/ prefix check)
  app.get("/auth/status", async () => ({
    methods: { totp: !!auth.totpSecret },
  }));

  // SPA calls /auth/login; CLI calls /auth/totp/verify — handle both
  const totpHandler = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!auth.totpSecret) {
      return reply.status(400).send({ error: "TOTP not configured" });
    }
    const { code } = (req.body as { code?: string }) ?? {};
    if (!code || typeof code !== "string") {
      return reply.status(400).send({ error: "Missing code" });
    }
    // Validate TOTP code using otpauth library
    const { TOTP, Secret } = await import("otpauth");
    const totp = new TOTP({
      issuer: "mecha", label: "dashboard",
      algorithm: "SHA1", digits: 6, period: 30,
      secret: Secret.fromBase32(auth.totpSecret),
    });
    const valid = totp.validate({ token: code, window: 1 }) !== null;
    if (!valid) {
      return reply.status(401).send({ error: "Invalid code" });
    }
    // Issue session cookie
    const { createSessionToken, deriveSessionKey } = await import("./session.js");
    const sessionKey = deriveSessionKey(auth.totpSecret);
    const token = createSessionToken(sessionKey, 0);
    reply.header("set-cookie", `mecha-session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return { ok: true };
  };
  app.post("/auth/totp/verify", totpHandler);
  app.post("/auth/login", totpHandler);

  // Task protocol routes
  registerTaskRoutes(app, { mechaDir, acl, authCtx });

  // Bot listing route — local bots or proxy to remote node
  app.get("/bots", async (req) => {
    const node = (req.query as Record<string, string>).node;
    if (node) {
      // Proxy to remote node's agent server
      const { readNodes } = await import("@mecha/core");
      const nodes = readNodes(mechaDir);
      const target = nodes.find((n) => n.name === node);
      if (!target) return [];
      try {
        const res = await fetch(`http://${target.host}:${target.port}/bots`, {
          headers: { Authorization: `Bearer ${target.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return res.json();
      } catch { /* node unreachable */ }
      return [];
    }
    const list = opts.processManager.list();
    return list.map((b) => {
      const config = readBotConfig(join(mechaDir, b.name));
      return { name: b.name, state: b.state, port: b.port ?? null, tags: config?.tags ?? [] };
    });
  });

  // Aggregated schedule overview across all bots — dashboard SPA
  app.get("/bots/schedules/overview", async () => {
    const bots = opts.processManager.list().filter(b => b.state === "running");
    const overview: Array<{ bot: string; id: string; every: string; paused: boolean }> = [];
    for (const bot of bots) {
      const config = readBotConfig(join(mechaDir, bot.name));
      if (!config?.port || !config?.token) continue;
      try {
        const res = await fetch(`http://127.0.0.1:${config.port}/api/schedules`, {
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = (await res.json()) as Array<{ id: string; trigger: { every: string }; paused?: boolean }>;
          for (const s of data) {
            overview.push({ bot: bot.name, id: s.id, every: s.trigger?.every ?? "", paused: !!s.paused });
          }
        }
      } catch { /* bot unreachable — skip */ }
    }
    return overview;
  });

  // Bot query route
  app.post<{ Params: { botName: string }; Body: QueryBody }>(
    "/bots/:botName/query",
    async (req, reply) => {
      const { botName } = req.params;

      // Validate bot name
      if (!isValidName(botName)) {
        return reply.status(400).send({ error: "Invalid bot name" });
      }

      // Parse body
      const body = req.body as QueryBody;
      if (!body || typeof body.message !== "string" || body.message.trim() === "") {
        return reply.status(400).send({ error: "Missing or empty message" });
      }

      // Verify request signature if present
      const rawBody = JSON.stringify(req.body);
      const sigError = verifyRequestSignature(req, rawBody, authCtx);
      if (sigError) {
        return reply.status(401).send({ error: sigError });
      }

      // ACL check — source from header, defaults to "admin"
      const source = (req.headers["x-mecha-source"] as string) ?? "admin";
      const aclResult = acl.check(source, botName, "query" as Capability);
      if (!aclResult.allowed) {
        return reply.status(403).send({ error: "Access denied", reason: aclResult.reason });
      }

      // Find bot config to get port and token
      const botDir = join(mechaDir, botName);
      const config = readBotConfig(botDir);
      if (!config) {
        return reply.status(404).send({ error: `Bot '${botName}' not found` });
      }

      // Forward query to the bot process
      try {
        const result = await forwardQueryToBot(
          config.port,
          config.token,
          body.message,
          body.sessionId,
          body.requestId,
        );
        return reply.send({
          response: result.text,
          sessionId: result.sessionId ?? null,
        });
      /* v8 ignore start -- forwarding failure requires unreachable bot process */
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: `Forwarding failed: ${msg}` });
      }
      /* v8 ignore stop */
    },
  );

  // ── Dashboard API routes ──────────────────────────────────────────
  // SPA client routes share paths with API routes (e.g. /schedules).
  // Browser navigation sends Accept: text/html — serve SPA index.html.
  // SPA fetch() sends Accept: */* — fall through to the JSON API route.
  const SPA_ROUTES = new Set([
    "/schedules", "/budgets", "/nodes", "/settings", "/audit", "/doctor",
    "/acl", "/auth", "/sandbox", "/bot",
  ]);
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "GET" || !opts.spaDir) return;
    const accept = req.headers.accept ?? "";
    // Browser sends "text/html,application/xhtml+xml,..."; fetch() sends "*/*"
    if (!accept.includes("text/html") || accept === "*/*") return;
    const path = req.url.split("?")[0] ?? req.url;
    if (SPA_ROUTES.has(path) || path.startsWith("/bot/")) {
      return (reply as unknown as { sendFile(f: string, r?: string): Promise<void> }).sendFile("index.html", opts.spaDir);
    }
  });

  // ACL rules
  app.get("/acl", async () => acl.listRules());

  // Available models
  app.get("/models", async () => {
    const { CLAUDE_MODELS } = await import("@mecha/core");
    return CLAUDE_MODELS;
  });

  // Node information
  app.get("/node/info", async () => {
    const { collectNodeInfo } = await import("@mecha/core");
    return collectNodeInfo({
      port: opts.port,
      startedAt: opts.startedAt ?? new Date().toISOString(),
      botCount: opts.processManager.list().length,
      publicIp: opts.publicIp,
    });
  });

  // Mesh nodes
  app.get("/mesh/nodes", async () => {
    const { readNodes } = await import("@mecha/core");
    const nodes = readNodes(mechaDir);
    // Probe each node's healthz in parallel
    const results = await Promise.all(nodes.map(async (n) => {
      const start = Date.now();
      try {
        const res = await fetch(`http://${n.host}:${n.port}/healthz`, {
          headers: { Authorization: `Bearer ${n.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const latencyMs = Date.now() - start;
          // Try to get node info
          let info: Record<string, unknown> = {};
          try {
            const infoRes = await fetch(`http://${n.host}:${n.port}/node/info`, {
              headers: { Authorization: `Bearer ${n.apiKey}` },
              signal: AbortSignal.timeout(3000),
            });
            if (infoRes.ok) info = (await infoRes.json()) as Record<string, unknown>;
          } catch { /* no info available */ }
          // Try to get bot count
          let botCount = 0;
          try {
            const botsRes = await fetch(`http://${n.host}:${n.port}/bots`, {
              headers: { Authorization: `Bearer ${n.apiKey}` },
              signal: AbortSignal.timeout(3000),
            });
            if (botsRes.ok) botCount = ((await botsRes.json()) as unknown[]).length;
          } catch { /* no bots info */ }
          return {
            name: n.name, status: "online" as const, latencyMs, botCount,
            port: n.port, tailscaleIp: n.host,
            hostname: info.hostname as string | undefined,
            platform: info.platform as string | undefined,
            arch: info.arch as string | undefined,
            cpuCount: info.cpuCount as number | undefined,
            totalMemMB: info.totalMemMB as number | undefined,
            freeMemMB: info.freeMemMB as number | undefined,
          };
        }
        return { name: n.name, status: "offline" as const, port: n.port, tailscaleIp: n.host, error: `HTTP ${res.status}` };
      } catch (err) {
        return { name: n.name, status: "offline" as const, port: n.port, tailscaleIp: n.host, error: err instanceof Error ? err.message : "unreachable" };
      }
    }));
    return results;
  });

  // TOTP status
  app.get("/settings/totp", async () => ({
    enabled: !!auth.totpSecret,
  }));

  // Runtime settings
  app.get("/settings/runtime", async () => {
    const { readMechaSettings } = await import("@mecha/core");
    return readMechaSettings(mechaDir) ?? {};
  });

  // Network settings
  app.get("/settings/network", async () => {
    const { readNodes } = await import("@mecha/core");
    const nodes = readNodes(mechaDir);
    return { nodes: nodes.length, tailscale: false };
  });

  // Auth profiles
  app.get("/settings/auth-profiles", async () => {
    try {
      const { listAuthProfiles } = await import("@mecha/core");
      return listAuthProfiles(mechaDir);
    /* v8 ignore start -- auth profiles may not be configured */
    } catch { return []; }
    /* v8 ignore stop */
  });

  // Schedules — aggregate from all running bots
  app.get("/schedules", async () => {
    const bots = opts.processManager.list().filter((b) => b.state === "running");
    const schedules: unknown[] = [];
    for (const bot of bots) {
      const config = readBotConfig(join(mechaDir, bot.name));
      if (!config) continue;
      try {
        const res = await fetch(`http://127.0.0.1:${config.port}/api/schedules`, {
          headers: { Authorization: `Bearer ${config.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          schedules.push(...(data as unknown[]).map((s) => ({ ...(s as Record<string, unknown>), bot: bot.name })));
        }
      /* v8 ignore start -- bot may be unreachable */
      } catch { /* bot unreachable */ }
      /* v8 ignore stop */
    }
    return schedules;
  });

  // Budgets
  app.get("/budgets", async () => {
    try {
      const { readBudgets, meterDir } = await import("@mecha/meter");
      return readBudgets(meterDir(mechaDir));
    /* v8 ignore start -- meter may not be configured */
    } catch { return { global: {}, byBot: {}, byAuthProfile: {}, byTag: {} }; }
    /* v8 ignore stop */
  });

  // Meter cost
  app.get("/meter/cost", async () => {
    try {
      const { queryCostToday, meterDir } = await import("@mecha/meter");
      return queryCostToday(meterDir(mechaDir));
    /* v8 ignore start -- meter may not be running */
    } catch { return { period: "today", total: { costUsd: 0, requests: 0 }, byBot: {} }; }
    /* v8 ignore stop */
  });

  // Meter status
  app.get("/meter/status", async () => {
    try {
      const { getMeterStatus, meterDir } = await import("@mecha/meter");
      return getMeterStatus(meterDir(mechaDir));
    /* v8 ignore start -- meter may not be configured */
    } catch { return { running: false }; }
    /* v8 ignore stop */
  });

  // Audit log (placeholder)
  app.get("/audit", async () => []);

  // Event log (placeholder)
  app.get("/events/log", async () => []);

  // Tools list (placeholder)
  app.get("/tools", async () => []);
  app.get("/tools/runtime", async () => ({ claudePath: null, version: null }));

  // Serve SPA static files if spaDir is provided.
  // @fastify/static is an optional peer dependency — resolved from the caller's
  // node_modules at runtime via dynamic import. If not installed, SPA serving
  // is silently skipped. The caller (e.g. @mecha/cli) must install @fastify/static
  // to enable this feature.
  /* v8 ignore start -- SPA serving requires built SPA assets and @fastify/static from caller */
  if (opts.spaDir) {
    const spaDir = opts.spaDir;
    void import("@fastify/static" as string).then(
      (mod) => app.register(mod.default ?? mod, { root: spaDir, prefix: "/", wildcard: false }),
      () => { /* @fastify/static not available — skip SPA serving */ },
    );
    app.setNotFoundHandler(async (_req, reply) => {
      return (reply as unknown as { sendFile(f: string, r?: string): Promise<void> }).sendFile("index.html", spaDir);
    });
  }
  /* v8 ignore stop */

  return app;
}
