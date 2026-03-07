import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName, readBotConfig, readAuthProfiles, validateBotConfig } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { botConfigure, checkBotBusy, mechaAuthLs, agentFetch } from "@mecha/service";
import type { BotConfigUpdates } from "@mecha/service";
import { existsSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { resolveNodeEntry } from "../node-resolve.js";
import { spawnOptsFromConfig } from "./spawn-opts.js";

function validateName(name: string, reply: FastifyReply): BotName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  return name as BotName;
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

/** Register bot config patch and auth profile routes. */
export function registerBotConfigRoutes(app: FastifyInstance, pm: ProcessManager, mechaDir: string, nodeName?: string): void {
  const node = nodeName ?? "local";

  // --- Update bot config fields, optionally restart ---
  interface ConfigPatchBody extends BotConfigUpdates {
    restart?: boolean;
    force?: boolean;
  }

  app.patch("/bots/:name/config", async (
    request: FastifyRequest<{ Params: { name: string }; Body: ConfigPatchBody; Querystring: { node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/config`, "PATCH", reply, request.body)) return;
    /* v8 ignore stop */
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
      if (typeof body.auth !== "string") {
        reply.code(400).send({ error: "auth must be a string or null" });
        return;
      }
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

    // Cross-field validation
    const validation = validateBotConfig({
      permissionMode: body.permissionMode,
      sandboxMode: body.sandboxMode,
      systemPrompt: body.systemPrompt,
      appendSystemPrompt: body.appendSystemPrompt,
      allowedTools: body.allowedTools,
      tools: body.tools,
      maxBudgetUsd: body.maxBudgetUsd,
    });
    if (!validation.ok) {
      reply.code(400).send({ error: validation.errors.join("; ") });
      return;
    }

    // Extract only allowed config fields — unknown fields are silently ignored
    // to prevent persisting arbitrary data (e.g. token, port overrides).
    const {
      restart, force, auth, model, tags, expose, sandboxMode, permissionMode, home, workspace,
      systemPrompt, appendSystemPrompt, effort, maxBudgetUsd, allowedTools, disallowedTools, tools,
      agent, agents, sessionPersistence, budgetLimit, mcpServers, mcpConfigFiles, strictMcpConfig,
      pluginDirs, disableSlashCommands, addDirs, env,
    } = body;
    /* v8 ignore start -- optional field spread; each undefined check is a branch */
    const configUpdates: BotConfigUpdates = {
      ...(auth !== undefined && { auth }),
      ...(model !== undefined && { model }),
      ...(tags !== undefined && { tags }),
      ...(expose !== undefined && { expose }),
      ...(sandboxMode !== undefined && { sandboxMode }),
      ...(permissionMode !== undefined && { permissionMode }),
      ...(home !== undefined && { home }),
      ...(workspace !== undefined && { workspace }),
      ...(systemPrompt !== undefined && { systemPrompt }),
      ...(appendSystemPrompt !== undefined && { appendSystemPrompt }),
      ...(effort !== undefined && { effort }),
      ...(maxBudgetUsd !== undefined && { maxBudgetUsd }),
      ...(allowedTools !== undefined && { allowedTools }),
      ...(disallowedTools !== undefined && { disallowedTools }),
      ...(tools !== undefined && { tools }),
      ...(agent !== undefined && { agent }),
      ...(agents !== undefined && { agents }),
      ...(sessionPersistence !== undefined && { sessionPersistence }),
      ...(budgetLimit !== undefined && { budgetLimit }),
      ...(mcpServers !== undefined && { mcpServers }),
      ...(mcpConfigFiles !== undefined && { mcpConfigFiles }),
      ...(strictMcpConfig !== undefined && { strictMcpConfig }),
      ...(pluginDirs !== undefined && { pluginDirs }),
      ...(disableSlashCommands !== undefined && { disableSlashCommands }),
      ...(addDirs !== undefined && { addDirs }),
      ...(env !== undefined && { env }),
    };
    /* v8 ignore stop */

    // Check busy BEFORE persisting config to avoid state mutation on 409
    let restarted = false;
    if (restart === true && info.state === "running" && force !== true) {
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

    // Persist config AFTER busy check passes
    botConfigure(mechaDir, pm, botName, configUpdates);

    if (restart === true && info.state === "running") {
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
