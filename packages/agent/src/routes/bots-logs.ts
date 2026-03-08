import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName, readBotConfig } from "@mecha/core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function validateName(name: string, reply: FastifyReply): BotName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  return name as BotName;
}

/** Register bot log and sandbox inspection routes. */
export function registerBotLogRoutes(app: FastifyInstance, mechaDir: string): void {
  // --- View bot logs ---
  app.get("/bots/:name/logs", async (
    request: FastifyRequest<{
      Params: { name: string };
      Querystring: { stream?: string; lines?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const validated = validateName(request.params.name, reply);
    if (!validated) return;

    const botDir = join(mechaDir, validated);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${validated}` });
      return;
    }

    const stream = request.query.stream === "stderr" ? "stderr" : "stdout";
    const logFile = join(botDir, "logs", `${stream}.log`);
    /* v8 ignore start -- NaN fallback for malformed lines param */
    const lines = Math.max(1, Math.min(5000, parseInt(request.query.lines ?? "200", 10) || 200));
    /* v8 ignore stop */

    if (!existsSync(logFile)) {
      return { lines: [] };
    }

    const content = await readFile(logFile, "utf-8");
    const allLines = content.split("\n").filter(Boolean);
    return { lines: allLines.slice(-lines) };
  });

  // --- Sandbox profile: settings + hooks ---
  app.get("/bots/:name/sandbox", async (
    request: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply,
  ) => {
    const validated = validateName(request.params.name, reply);
    if (!validated) return;

    const botDir = join(mechaDir, validated);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${validated}` });
      return;
    }

    const claudeDir = join(botDir, ".claude");
    let settings: Record<string, unknown> = {};
    const settingsPath = join(claudeDir, "settings.json");
    if (existsSync(settingsPath)) {
      /* v8 ignore start -- corrupt JSON fallback */
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      } catch { /* invalid JSON — use defaults */ }
      /* v8 ignore stop */
    }

    const hooksDir = join(claudeDir, "hooks");
    let hooks: string[] = [];
    if (existsSync(hooksDir)) {
      /* v8 ignore start -- fs error fallback */
      try {
        hooks = readdirSync(hooksDir).filter((f) => f.endsWith(".sh"));
      } catch { /* ignore */ }
      /* v8 ignore stop */
    }

    const config = readBotConfig(join(mechaDir, validated));

    return {
      name: validated,
      /* v8 ignore start -- null coalescing fallback for missing sandboxMode */
      sandboxMode: config?.sandboxMode ?? "auto",
      /* v8 ignore stop */
      settings,
      hooks,
    };
  });
}
