import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName, readBotConfig, BotNotRunningError, getNetworkIps } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { checkBotBusy, enrichBotInfo, buildEnrichContext, getCachedSnapshot, batchBotAction, agentFetch } from "@mecha/service";
import type { EnrichedBotInfo } from "@mecha/service";
import { existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { hostname as osHostname } from "node:os";
import { resolveNodeEntry } from "../node-resolve.js";
import { registerBotLogRoutes } from "./bots-logs.js";
import { registerBotConfigRoutes } from "./bots-config.js";
import { registerBotSpawnRoute } from "./bots-spawn.js";
import { spawnOptsFromConfig } from "./spawn-opts.js";

function validateName(name: string, reply: FastifyReply): BotName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  return name as BotName;
}

interface ForceBody { force?: boolean }

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
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    console.warn(`[proxyToNode] ${method} ${path} → node "${targetNode}" failed: ${cause}`);
    reply.code(502).send({ error: `Cannot reach node "${targetNode}"` });
    return true;
  }
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

  // --- Spawn (POST /bots) — extracted to bots-spawn.ts ---
  registerBotSpawnRoute(app, pm);

  // --- Remove a bot: stop/kill if running, then delete its directory ---
  app.delete("/bots/:name", async (
    request: FastifyRequest<{ Params: { name: string }; Querystring: { force?: string; node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}?force=${request.query.force ?? "false"}`, "DELETE", reply)) return;
    /* v8 ignore stop */
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
