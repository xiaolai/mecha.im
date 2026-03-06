import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, type SandboxMode, isValidName, readBotConfig, readAuthProfiles, BotNotRunningError, getNetworkIps } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { botConfigure, checkBotBusy, enrichBotInfo, buildEnrichContext, getCachedSnapshot, mechaAuthLs, batchBotAction, agentFetch } from "@mecha/service";
import type { BotConfigUpdates, EnrichedBotInfo } from "@mecha/service";
import { existsSync, statSync } from "node:fs";
import { join, basename, resolve, isAbsolute } from "node:path";
import { hostname as osHostname } from "node:os";
import { resolveNodeEntry } from "../node-resolve.js";

function validateName(name: string, reply: FastifyReply): BotName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  return name as BotName;
}

interface ForceBody { force?: boolean }

function spawnOptsFromConfig(name: BotName, config: ReturnType<typeof readBotConfig> & object) {
  return {
    name,
    workspacePath: config.workspace,
    home: config.home,
    port: config.port,
    /* v8 ignore start -- null coalescing fallback for optional auth field */
    auth: config.auth ?? undefined,
    /* v8 ignore stop */
    tags: config.tags,
    expose: config.expose,
    sandboxMode: config.sandboxMode,
    model: config.model,
    permissionMode: config.permissionMode,
  };
}

/** List endpoint projection — omit pid/exitCode, shorten workspacePath to basename. */
function listProjection(info: EnrichedBotInfo) {
  const { pid: _pid, exitCode: _exitCode, stoppedAt: _stoppedAt, ...rest } = info;
  return { ...rest, workspacePath: basename(info.workspacePath) };
}

/** Register bot CRUD routes: list, create, start, stop, kill, restart, and config patch. */
export function registerBotRoutes(app: FastifyInstance, pm: ProcessManager, mechaDir: string, nodeName?: string): void {
  const meterDir = join(mechaDir, "meter");
  const node = nodeName ?? "local";
  const host = osHostname();
  const { lanIp, tailscaleIp } = getNetworkIps();

  app.get("/bots", async (request: FastifyRequest<{ Querystring: { node?: string } }>, reply: FastifyReply) => {
    const targetNode = (request.query as { node?: string }).node;

    // Proxy to remote node if ?node= is set and doesn't match local
    /* v8 ignore start -- proxy requires live remote node */
    if (targetNode && targetNode !== node && targetNode !== "local") {
      const entry = resolveNodeEntry(mechaDir, targetNode);
      if (!entry) {
        reply.code(404).send({ error: `Node not found: ${targetNode}` });
        return;
      }
      try {
        const res = await agentFetch({ node: entry, path: "/bots", method: "GET", source: node, timeoutMs: 5_000 });
        if (!res.ok) {
          reply.code(502).send({ error: `Remote node "${targetNode}" returned ${res.status}` });
          return;
        }
        return res.json();
      } catch {
        reply.code(502).send({ error: `Cannot reach node "${targetNode}"` });
        return;
      }
    }
    /* v8 ignore stop */

    const list = pm.list();
    const snapshot = getCachedSnapshot(meterDir);
    const ctx = buildEnrichContext(mechaDir, snapshot, list.map((p) => p.name));
    return list.map((p) => {
      const enriched = enrichBotInfo(p, ctx);
      return { ...listProjection(enriched), node, hostname: host, lanIp, tailscaleIp, homeDir: enriched.homeDir ?? join(mechaDir, p.name) };
    });
  });

  // --- Batch stop/restart — registered BEFORE :name routes so "batch" isn't treated as a bot name ---
  interface BatchBody { action: string; force?: unknown; idleOnly?: unknown; dryRun?: unknown; names?: unknown }
  app.post("/bots/batch", async (request: FastifyRequest<{ Body: BatchBody }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as BatchBody;
    /* v8 ignore stop */
    if (body.action !== "stop" && body.action !== "restart") {
      reply.code(400).send({ error: "action must be 'stop' or 'restart'" });
      return;
    }
    const result = await batchBotAction({
      pm, mechaDir, action: body.action as "stop" | "restart",
      force: body.force === true,
      idleOnly: body.idleOnly === true,
      dryRun: body.dryRun === true,
      names: Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : undefined,
    });
    return result;
  });

  app.get("/bots/:name/status", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const info = pm.get(botName);
    if (!info) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    const snapshot = getCachedSnapshot(meterDir);
    const ctx = buildEnrichContext(mechaDir, snapshot, [botName]);
    return enrichBotInfo(info, ctx);
  });

  // --- Start a stopped bot from its persisted config ---
  app.post("/bots/:name/start", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const config = readBotConfig(join(mechaDir, botName));
    if (!config) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    const existing = pm.get(botName);
    if (existing?.state === "running") {
      reply.code(409).send({ error: `bot already running: ${botName}`, code: "BOT_ALREADY_RUNNING" });
      return;
    }
    const result = await pm.spawn(spawnOptsFromConfig(botName, config));
    return { ok: true, name: botName, port: result.port };
  });

  // --- Restart: stop (with task check) + re-spawn ---
  app.post("/bots/:name/restart", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const config = readBotConfig(join(mechaDir, botName));
    if (!config) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as ForceBody;
    /* v8 ignore stop */
    const existing = pm.get(botName);
    if (existing?.state === "running") {
      if (body.force !== true) {
        const check = await checkBotBusy(pm, botName);
        if (check.busy) {
          reply.code(409).send({
            error: `bot has ${check.activeSessions} active session(s)`,
            code: "BOT_BUSY",
            activeSessions: check.activeSessions,
            lastActivity: check.lastActivity,
          });
          return;
        }
      }
      if (body.force === true) {
        await pm.kill(botName);
      } else {
        await pm.stop(botName);
      }
    }
    const result = await pm.spawn(spawnOptsFromConfig(botName, config));
    return { ok: true, name: botName, port: result.port };
  });

  // --- Stop with task safety check ---
  app.post("/bots/:name/stop", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const info = pm.get(botName);
    if (!info) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    if (info.state !== "running") {
      throw new BotNotRunningError(botName);
    }
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as ForceBody;
    /* v8 ignore stop */
    if (body.force !== true) {
      const check = await checkBotBusy(pm, botName);
      if (check.busy) {
        reply.code(409).send({
          error: `bot has ${check.activeSessions} active session(s)`,
          code: "BOT_BUSY",
          activeSessions: check.activeSessions,
          lastActivity: check.lastActivity,
        });
        return;
      }
    }
    await pm.stop(botName);
    return { ok: true };
  });

  app.post("/bots/:name/kill", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const info = pm.get(botName);
    if (!info) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    await pm.kill(botName);
    return { ok: true };
  });

  interface SpawnBody {
    name?: string;
    workspacePath?: string;
    model?: string;
    permissionMode?: string;
    auth?: string | null;
    tags?: string[];
    expose?: string[];
    sandboxMode?: string;
    meterOff?: boolean;
    home?: string;
  }

  app.post("/bots", async (request: FastifyRequest<{ Body: SpawnBody }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = request.body ?? {};
    /* v8 ignore stop */
    const rawName = body.name;
    if (!rawName || !isValidName(rawName)) {
      reply.code(400).send({ error: `Invalid bot name: ${rawName ?? "(missing)"}` });
      return;
    }
    if (!body.workspacePath) {
      reply.code(400).send({ error: "Missing workspacePath" });
      return;
    }
    const botName = rawName as BotName;
    const existing = pm.get(botName);
    if (existing) {
      reply.code(409).send({ error: `bot already exists: ${botName}` });
      return;
    }
    const result = await pm.spawn({
      name: botName,
      workspacePath: body.workspacePath,
      ...(body.model && { model: body.model }),
      ...(body.permissionMode && { permissionMode: body.permissionMode }),
      ...(body.auth !== undefined && { auth: body.auth }),
      ...(body.tags && { tags: body.tags }),
      ...(body.expose && { expose: body.expose }),
      ...(body.sandboxMode && { sandboxMode: body.sandboxMode as SandboxMode }),
      ...(body.meterOff !== undefined && { meterOff: body.meterOff }),
      ...(body.home && { home: body.home }),
    });
    return { ok: true, name: botName, port: result.port };
  });

  // --- Update bot config fields, optionally restart ---
  interface ConfigPatchBody extends BotConfigUpdates {
    restart?: boolean;
    force?: boolean;
  }

  app.patch("/bots/:name/config", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ConfigPatchBody }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;
    const info = pm.get(botName);
    if (!info) {
      reply.code(404).send({ error: `bot not found: ${botName}` });
      return;
    }
    /* v8 ignore start -- Fastify always parses body for PATCH */
    const body = (request.body ?? {}) as ConfigPatchBody;
    /* v8 ignore stop */

    // Validate auth profile exists if specified
    /* v8 ignore start -- auth validation branches: $env sentinel requires env vars, store lookup tested in routes.test.ts */
    if (body.auth !== undefined && body.auth !== null) {
      if (body.auth.startsWith("$env:")) {
        const envMap: Record<string, string> = { "$env:api-key": "ANTHROPIC_API_KEY", "$env:oauth": "CLAUDE_CODE_OAUTH_TOKEN" };
        const envVar = envMap[body.auth];
        if (!envVar || !process.env[envVar]) {
          reply.code(400).send({ error: `Auth profile not found: ${body.auth}` });
          return;
        }
      } else {
        const store = readAuthProfiles(mechaDir);
        if (!store.profiles[body.auth]) {
          reply.code(400).send({ error: `Auth profile not found: ${body.auth}` });
          return;
        }
      }
    }
    /* v8 ignore stop */

    // Validate home path if specified — must be absolute
    if (body.home !== undefined) {
      if (typeof body.home !== "string" || body.home.length === 0) {
        reply.code(400).send({ error: "home must be a non-empty string" });
        return;
      }
      if (!isAbsolute(body.home)) {
        reply.code(400).send({ error: "home must be an absolute path" });
        return;
      }
      body.home = resolve(body.home);
      if (!existsSync(body.home) || !statSync(body.home).isDirectory()) {
        reply.code(400).send({ error: `home directory does not exist: ${body.home}` });
        return;
      }
    }
    // Validate workspace path if specified — must be absolute
    if (body.workspace !== undefined) {
      if (typeof body.workspace !== "string" || body.workspace.length === 0) {
        reply.code(400).send({ error: "workspace must be a non-empty string" });
        return;
      }
      if (!isAbsolute(body.workspace)) {
        reply.code(400).send({ error: "workspace must be an absolute path" });
        return;
      }
      body.workspace = resolve(body.workspace);
      if (!existsSync(body.workspace) || !statSync(body.workspace).isDirectory()) {
        reply.code(400).send({ error: `workspace directory does not exist: ${body.workspace}` });
        return;
      }
    }

    // Extract only allowed config fields — reject unknown fields to prevent
    // persisting arbitrary data (e.g. token, port overrides).
    const { restart, force, auth, model, tags, expose, sandboxMode, permissionMode, home, workspace } = body;
    const configUpdates: BotConfigUpdates = {
      ...(auth !== undefined && { auth }),
      ...(model !== undefined && { model }),
      ...(tags !== undefined && { tags }),
      ...(expose !== undefined && { expose }),
      ...(sandboxMode !== undefined && { sandboxMode }),
      ...(permissionMode !== undefined && { permissionMode }),
      ...(home !== undefined && { home }),
      ...(workspace !== undefined && { workspace }),
    };
    botConfigure(mechaDir, pm, botName, configUpdates);

    let restarted = false;
    if (restart === true && info.state === "running") {
      if (force !== true) {
        const check = await checkBotBusy(pm, botName);
        if (check.busy) {
          reply.code(409).send({
            error: `bot has ${check.activeSessions} active session(s)`,
            code: "BOT_BUSY",
            activeSessions: check.activeSessions,
            lastActivity: check.lastActivity,
          });
          return;
        }
      }
      if (force === true) {
        await pm.kill(botName);
      } else {
        await pm.stop(botName);
      }
      const config = readBotConfig(join(mechaDir, botName));
      /* v8 ignore start -- config always exists after botConfigure */
      if (config) {
        await pm.spawn(spawnOptsFromConfig(botName, config));
      }
      /* v8 ignore stop */
      restarted = true;
    }

    return { ok: true, restarted };
  });

  // --- List auth profiles (for UI dropdowns) ---
  app.get("/auth/profiles", async () => {
    return mechaAuthLs(mechaDir);
  });
}
