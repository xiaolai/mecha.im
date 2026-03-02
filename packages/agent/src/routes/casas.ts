import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName, readCasaConfig, CasaNotRunningError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { checkCasaBusy } from "@mecha/service";
import { join } from "node:path";

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

export function registerCasaRoutes(app: FastifyInstance, pm: ProcessManager, mechaDir: string): void {
  app.get("/casas", async () => {
    const list = pm.list();
    return list.map((p) => ({
      name: p.name,
      state: p.state,
      port: p.port,
    }));
  });

  app.get("/casas/:name/status", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    return { name: info.name, state: info.state, port: info.port };
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
}
