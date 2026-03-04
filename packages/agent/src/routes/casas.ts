import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName, readCasaConfig, readAuthProfiles, CasaNotRunningError, getNetworkIps } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { casaConfigure, checkCasaBusy, enrichCasaInfo, buildEnrichContext, getCachedSnapshot, mechaAuthLs, batchCasaAction } from "@mecha/service";
import type { CasaConfigUpdates, EnrichedCasaInfo } from "@mecha/service";
import { join, basename } from "node:path";
import { hostname as osHostname } from "node:os";

function validateName(name: string, reply: FastifyReply): CasaName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid CASA name: ${name}` });
    return null;
  }
  return name as CasaName;
}

interface ForceBody { force?: boolean }

function spawnOptsFromConfig(name: CasaName, config: ReturnType<typeof readCasaConfig> & object) {
  return {
    name,
    workspacePath: config.workspace,
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
function listProjection(info: EnrichedCasaInfo) {
  const { pid: _pid, exitCode: _exitCode, stoppedAt: _stoppedAt, ...rest } = info;
  return { ...rest, workspacePath: basename(info.workspacePath) };
}

export function registerCasaRoutes(app: FastifyInstance, pm: ProcessManager, mechaDir: string, nodeName?: string): void {
  const meterDir = join(mechaDir, "meter");
  const node = nodeName ?? "local";
  const host = osHostname();
  const { lanIp, tailscaleIp } = getNetworkIps();

  app.get("/casas", async () => {
    const list = pm.list();
    const snapshot = getCachedSnapshot(meterDir);
    const ctx = buildEnrichContext(mechaDir, snapshot, list.map((p) => p.name));
    return list.map((p) => {
      const enriched = enrichCasaInfo(p, ctx);
      const homeDir = join(mechaDir, p.name, "home");
      return { ...listProjection(enriched), node, hostname: host, lanIp, tailscaleIp, homeDir };
    });
  });

  // --- Batch stop/restart — registered BEFORE :name routes so "batch" isn't treated as a CASA name ---
  interface BatchBody { action: string; force?: unknown; idleOnly?: unknown; dryRun?: unknown; names?: unknown }
  app.post("/casas/batch", async (request: FastifyRequest<{ Body: BatchBody }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as BatchBody;
    /* v8 ignore stop */
    if (body.action !== "stop" && body.action !== "restart") {
      reply.code(400).send({ error: "action must be 'stop' or 'restart'" });
      return;
    }
    const result = await batchCasaAction({
      pm, mechaDir, action: body.action as "stop" | "restart",
      force: body.force === true,
      idleOnly: body.idleOnly === true,
      dryRun: body.dryRun === true,
      names: Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : undefined,
    });
    return result;
  });

  app.get("/casas/:name/status", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    const snapshot = getCachedSnapshot(meterDir);
    const ctx = buildEnrichContext(mechaDir, snapshot, [casaName]);
    return enrichCasaInfo(info, ctx);
  });

  // --- Start a stopped CASA from its persisted config ---
  app.post("/casas/:name/start", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const config = readCasaConfig(join(mechaDir, casaName));
    if (!config) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    const existing = pm.get(casaName);
    if (existing?.state === "running") {
      reply.code(409).send({ error: `CASA already running: ${casaName}`, code: "CASA_ALREADY_RUNNING" });
      return;
    }
    const result = await pm.spawn(spawnOptsFromConfig(casaName, config));
    return { ok: true, name: casaName, port: result.port };
  });

  // --- Restart: stop (with task check) + re-spawn ---
  app.post("/casas/:name/restart", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody }>,
    reply: FastifyReply,
  ) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const config = readCasaConfig(join(mechaDir, casaName));
    if (!config) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as ForceBody;
    /* v8 ignore stop */
    const existing = pm.get(casaName);
    if (existing?.state === "running") {
      if (body.force !== true) {
        const check = await checkCasaBusy(pm, casaName);
        if (check.busy) {
          reply.code(409).send({
            error: `CASA has ${check.activeSessions} active session(s)`,
            code: "CASA_BUSY",
            activeSessions: check.activeSessions,
            lastActivity: check.lastActivity,
          });
          return;
        }
      }
      if (body.force === true) {
        await pm.kill(casaName);
      } else {
        await pm.stop(casaName);
      }
    }
    const result = await pm.spawn(spawnOptsFromConfig(casaName, config));
    return { ok: true, name: casaName, port: result.port };
  });

  // --- Stop with task safety check ---
  app.post("/casas/:name/stop", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ForceBody }>,
    reply: FastifyReply,
  ) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    if (info.state !== "running") {
      throw new CasaNotRunningError(casaName);
    }
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as ForceBody;
    /* v8 ignore stop */
    if (body.force !== true) {
      const check = await checkCasaBusy(pm, casaName);
      if (check.busy) {
        reply.code(409).send({
          error: `CASA has ${check.activeSessions} active session(s)`,
          code: "CASA_BUSY",
          activeSessions: check.activeSessions,
          lastActivity: check.lastActivity,
        });
        return;
      }
    }
    await pm.stop(casaName);
    return { ok: true };
  });

  app.post("/casas/:name/kill", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    await pm.kill(casaName);
    return { ok: true };
  });

  app.post("/casas", async (request: FastifyRequest<{ Body: { name?: string; workspacePath?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = request.body ?? {};
    /* v8 ignore stop */
    const rawName = body.name;
    if (!rawName || !isValidName(rawName)) {
      reply.code(400).send({ error: `Invalid CASA name: ${rawName ?? "(missing)"}` });
      return;
    }
    if (!body.workspacePath) {
      reply.code(400).send({ error: "Missing workspacePath" });
      return;
    }
    const casaName = rawName as CasaName;
    const existing = pm.get(casaName);
    if (existing) {
      reply.code(409).send({ error: `CASA already exists: ${casaName}` });
      return;
    }
    const result = await pm.spawn({ name: casaName, workspacePath: body.workspacePath });
    return { ok: true, name: casaName, port: result.port };
  });

  // --- Update CASA config fields, optionally restart ---
  interface ConfigPatchBody extends CasaConfigUpdates {
    restart?: boolean;
    force?: boolean;
  }

  app.patch("/casas/:name/config", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ConfigPatchBody }>,
    reply: FastifyReply,
  ) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
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

    // Extract only allowed config fields — reject unknown fields to prevent
    // persisting arbitrary data (e.g. token, workspace, port overrides).
    const { restart, force, auth, model, tags, expose, sandboxMode, permissionMode } = body;
    const configUpdates: CasaConfigUpdates = {
      ...(auth !== undefined && { auth }),
      ...(model !== undefined && { model }),
      ...(tags !== undefined && { tags }),
      ...(expose !== undefined && { expose }),
      ...(sandboxMode !== undefined && { sandboxMode }),
      ...(permissionMode !== undefined && { permissionMode }),
    };
    casaConfigure(mechaDir, pm, casaName, configUpdates);

    let restarted = false;
    if (restart === true && info.state === "running") {
      if (force !== true) {
        const check = await checkCasaBusy(pm, casaName);
        if (check.busy) {
          reply.code(409).send({
            error: `CASA has ${check.activeSessions} active session(s)`,
            code: "CASA_BUSY",
            activeSessions: check.activeSessions,
            lastActivity: check.lastActivity,
          });
          return;
        }
      }
      if (force === true) {
        await pm.kill(casaName);
      } else {
        await pm.stop(casaName);
      }
      const config = readCasaConfig(join(mechaDir, casaName));
      /* v8 ignore start -- config always exists after casaConfigure */
      if (config) {
        await pm.spawn(spawnOptsFromConfig(casaName, config));
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
