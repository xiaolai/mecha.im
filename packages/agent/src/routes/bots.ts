import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, type SandboxMode, isValidName, readBotConfig, BotNotRunningError, getNetworkIps, validateBotConfig } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { checkBotBusy, enrichBotInfo, buildEnrichContext, getCachedSnapshot, batchBotAction, agentFetch } from "@mecha/service";
import type { EnrichedBotInfo } from "@mecha/service";
import { existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { hostname as osHostname } from "node:os";
import { resolveNodeEntry } from "../node-resolve.js";
import { registerBotLogRoutes } from "./bots-logs.js";
import { registerBotConfigRoutes } from "./bots-config.js";

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
    systemPrompt: config.systemPrompt,
    appendSystemPrompt: config.appendSystemPrompt,
    effort: config.effort,
    maxBudgetUsd: config.maxBudgetUsd,
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
    tools: config.tools,
    agent: config.agent,
    agents: config.agents,
    sessionPersistence: config.sessionPersistence,
    budgetLimit: config.budgetLimit,
    mcpServers: config.mcpServers,
    mcpConfigFiles: config.mcpConfigFiles,
    strictMcpConfig: config.strictMcpConfig,
    pluginDirs: config.pluginDirs,
    disableSlashCommands: config.disableSlashCommands,
    addDirs: config.addDirs,
    env: config.env,
  };
}

/** List endpoint projection — omit pid/exitCode, shorten workspacePath to basename. */
function listProjection(info: EnrichedBotInfo) {
  const { pid: _pid, exitCode: _exitCode, stoppedAt: _stoppedAt, ...rest } = info;
  return { ...rest, workspacePath: basename(info.workspacePath) };
}

/**
 * Proxy a request to a remote node if ?node= targets a different node.
 * Returns true if the request was proxied (caller should return early).
 */
/* v8 ignore start -- proxy requires live remote node */
async function proxyToNode(
  mechaDir: string, localNode: string, targetNode: string | undefined,
  path: string, method: string, reply: FastifyReply, body?: unknown,
): Promise<boolean> {
  if (!targetNode || targetNode === localNode || targetNode === "local") return false;
  const entry = resolveNodeEntry(mechaDir, targetNode);
  if (!entry) { reply.code(404).send({ error: `Node not found: ${targetNode}` }); return true; }
  try {
    const res = await agentFetch({ node: entry, path, method, source: localNode, timeoutMs: 10_000, body });
    if (!res.ok) { reply.code(502).send({ error: `Remote node "${targetNode}" returned ${res.status}` }); return true; }
    const data = await res.json();
    reply.send(data);
    return true;
  } catch { reply.code(502).send({ error: `Cannot reach node "${targetNode}"` }); return true; }
}
/* v8 ignore stop */

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
    if (await proxyToNode(mechaDir, node, targetNode, "/bots", "GET", reply)) return;
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

  app.get("/bots/:name/status", async (request: FastifyRequest<{ Params: { name: string }; Querystring: { node?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/status`, "GET", reply)) return;
    /* v8 ignore stop */
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
  app.post("/bots/:name/start", async (request: FastifyRequest<{ Params: { name: string }; Querystring: { node?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/start`, "POST", reply)) return;
    /* v8 ignore stop */
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
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody; Querystring: { node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/restart`, "POST", reply, request.body)) return;
    /* v8 ignore stop */
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
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody; Querystring: { node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/stop`, "POST", reply, request.body)) return;
    /* v8 ignore stop */
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

  app.post("/bots/:name/kill", async (request: FastifyRequest<{ Params: { name: string }; Querystring: { node?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/kill`, "POST", reply)) return;
    /* v8 ignore stop */
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
    systemPrompt?: string;
    appendSystemPrompt?: string;
    effort?: string;
    maxBudgetUsd?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
    tools?: string[];
    agent?: string;
    agents?: Record<string, { description: string; prompt: string }>;
    sessionPersistence?: boolean;
    budgetLimit?: number;
    mcpServers?: Record<string, unknown>;
    mcpConfigFiles?: string[];
    strictMcpConfig?: boolean;
    pluginDirs?: string[];
    disableSlashCommands?: boolean;
    addDirs?: string[];
    env?: Record<string, string>;
  }

  app.post("/bots", async (request: FastifyRequest<{ Body: SpawnBody }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = request.body ?? {};
    /* v8 ignore stop */
    const rawName = body.name;
    if (!rawName || !isValidName(rawName)) {
      /* v8 ignore start -- null coalescing fallback for missing name */
      reply.code(400).send({ error: `Invalid bot name: ${rawName ?? "(missing)"}` });
      /* v8 ignore stop */
      return;
    }
    if (!body.workspacePath || typeof body.workspacePath !== "string") {
      reply.code(400).send({ error: "Missing or invalid workspacePath (must be a string)" });
      return;
    }
    if (body.model !== undefined && typeof body.model !== "string") {
      reply.code(400).send({ error: "model must be a string" });
      return;
    }
    if (body.permissionMode !== undefined && typeof body.permissionMode !== "string") {
      reply.code(400).send({ error: "permissionMode must be a string" });
      return;
    }
    if (body.auth !== undefined && body.auth !== null && typeof body.auth !== "string") {
      reply.code(400).send({ error: "auth must be a string or null" });
      return;
    }
    if (body.home !== undefined && typeof body.home !== "string") {
      reply.code(400).send({ error: "home must be a string" });
      return;
    }
    const validSandboxModes = ["auto", "off", "require"];
    if (body.sandboxMode && !validSandboxModes.includes(body.sandboxMode)) {
      reply.code(400).send({ error: `Invalid sandboxMode. Valid: ${validSandboxModes.join(", ")}` });
      return;
    }
    if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((t: unknown) => typeof t === "string"))) {
      reply.code(400).send({ error: "tags must be an array of strings" });
      return;
    }
    if (body.expose !== undefined && (!Array.isArray(body.expose) || !body.expose.every((e: unknown) => typeof e === "string"))) {
      reply.code(400).send({ error: "expose must be an array of strings" });
      return;
    }
    const validation = validateBotConfig({
      permissionMode: body.permissionMode,
      sandboxMode: body.sandboxMode,
      systemPrompt: body.systemPrompt,
      appendSystemPrompt: body.appendSystemPrompt,
      allowedTools: body.allowedTools,
      tools: body.tools,
      maxBudgetUsd: body.maxBudgetUsd,
      meterOff: body.meterOff,
    });
    if (!validation.ok) {
      reply.code(400).send({ error: validation.errors.join("; ") });
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
      /* v8 ignore start -- optional field spread; each truthy/defined check is a branch */
      ...(body.model && { model: body.model }),
      ...(body.permissionMode && { permissionMode: body.permissionMode }),
      ...(body.auth !== undefined && { auth: body.auth }),
      ...(body.tags && { tags: body.tags }),
      ...(body.expose && { expose: body.expose }),
      ...(body.sandboxMode && { sandboxMode: body.sandboxMode as SandboxMode }),
      ...(body.meterOff !== undefined && { meterOff: body.meterOff }),
      ...(body.home && { home: body.home }),
      ...(body.systemPrompt && { systemPrompt: body.systemPrompt }),
      ...(body.appendSystemPrompt && { appendSystemPrompt: body.appendSystemPrompt }),
      ...(body.effort && { effort: body.effort }),
      ...(body.maxBudgetUsd != null && { maxBudgetUsd: body.maxBudgetUsd }),
      ...(body.allowedTools && { allowedTools: body.allowedTools }),
      ...(body.disallowedTools && { disallowedTools: body.disallowedTools }),
      ...(body.tools && { tools: body.tools }),
      ...(body.agent && { agent: body.agent }),
      ...(body.agents && { agents: body.agents }),
      ...(body.sessionPersistence != null && { sessionPersistence: body.sessionPersistence }),
      ...(body.budgetLimit != null && { budgetLimit: body.budgetLimit }),
      ...(body.mcpServers && { mcpServers: body.mcpServers }),
      ...(body.mcpConfigFiles && { mcpConfigFiles: body.mcpConfigFiles }),
      ...(body.strictMcpConfig != null && { strictMcpConfig: body.strictMcpConfig }),
      ...(body.pluginDirs && { pluginDirs: body.pluginDirs }),
      ...(body.disableSlashCommands != null && { disableSlashCommands: body.disableSlashCommands }),
      ...(body.addDirs && { addDirs: body.addDirs }),
      ...(body.env && { env: body.env }),
      /* v8 ignore stop */
    });
    return { ok: true, name: botName, port: result.port };
  });

  // --- Remove a bot: stop/kill if running, then delete its directory ---
  app.delete("/bots/:name", async (
    request: FastifyRequest<{ Params: { name: string }; Querystring: { force?: string } }>,
    reply: FastifyReply,
  ) => {
    const validated = validateName(request.params.name, reply);
    if (!validated) return;

    const botDir = join(mechaDir, validated);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${validated}` });
      return;
    }

    const existing = pm.get(validated);
    if (existing?.state === "running") {
      const force = request.query.force === "true";
      if (!force) {
        const check = await checkBotBusy(pm, validated);
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
      if (force) await pm.kill(validated);
      else await pm.stop(validated);
    }

    rmSync(botDir, { recursive: true, force: true });
    return { ok: true };
  });

  // Register extracted route modules
  registerBotLogRoutes(app, mechaDir);
  registerBotConfigRoutes(app, pm, mechaDir, nodeName);
}
