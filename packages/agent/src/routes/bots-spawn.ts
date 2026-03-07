import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, type SandboxMode, isValidName, validateBotConfig } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

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

/** Register POST /bots spawn route. */
export function registerBotSpawnRoute(app: FastifyInstance, pm: ProcessManager): void {
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
    if (body.agents !== undefined) {
      if (typeof body.agents !== "object" || body.agents === null || Array.isArray(body.agents)) {
        reply.code(400).send({ error: "agents must be an object mapping name to { description, prompt }" });
        return;
      }
      for (const [k, v] of Object.entries(body.agents)) {
        if (typeof v !== "object" || v === null || typeof (v as Record<string, unknown>).description !== "string" || typeof (v as Record<string, unknown>).prompt !== "string") {
          reply.code(400).send({ error: `agents.${k} must have string 'description' and 'prompt' fields` });
          return;
        }
      }
    }
    const validEfforts = ["low", "medium", "high"];
    if (body.effort !== undefined && (typeof body.effort !== "string" || !validEfforts.includes(body.effort))) {
      reply.code(400).send({ error: `Invalid effort. Valid: ${validEfforts.join(", ")}` });
      return;
    }
    const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x: unknown) => typeof x === "string");
    if (body.allowedTools !== undefined && !isStringArray(body.allowedTools)) {
      reply.code(400).send({ error: "allowedTools must be an array of strings" });
      return;
    }
    if (body.disallowedTools !== undefined && !isStringArray(body.disallowedTools)) {
      reply.code(400).send({ error: "disallowedTools must be an array of strings" });
      return;
    }
    if (body.tools !== undefined && !isStringArray(body.tools)) {
      reply.code(400).send({ error: "tools must be an array of strings" });
      return;
    }
    if (body.addDirs !== undefined && !isStringArray(body.addDirs)) {
      reply.code(400).send({ error: "addDirs must be an array of strings" });
      return;
    }
    if (body.mcpConfigFiles !== undefined && !isStringArray(body.mcpConfigFiles)) {
      reply.code(400).send({ error: "mcpConfigFiles must be an array of strings" });
      return;
    }
    if (body.pluginDirs !== undefined && !isStringArray(body.pluginDirs)) {
      reply.code(400).send({ error: "pluginDirs must be an array of strings" });
      return;
    }
    if (body.env !== undefined && (typeof body.env !== "object" || body.env === null || Array.isArray(body.env))) {
      reply.code(400).send({ error: "env must be an object mapping string keys to string values" });
      return;
    }
    const validation = validateBotConfig({
      permissionMode: body.permissionMode,
      sandboxMode: body.sandboxMode,
      systemPrompt: body.systemPrompt,
      appendSystemPrompt: body.appendSystemPrompt,
      allowedTools: body.allowedTools,
      disallowedTools: body.disallowedTools,
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
      ...(body.effort && { effort: body.effort as "low" | "medium" | "high" }),
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
}
