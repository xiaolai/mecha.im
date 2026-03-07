import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName, readBotConfig, PathTraversalError } from "@mecha/core";
import { resolveBotHome, listBotDir, readBotFile, writeBotFile, FileNotFoundError, NotMarkdownError, FileTooLargeError } from "@mecha/service";
import { join } from "node:path";
import { existsSync } from "node:fs";

function validateName(name: string, reply: FastifyReply): BotName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  return name as BotName;
}

/** Register bot file browsing and markdown read/write routes. */
export function registerBotFileRoutes(app: FastifyInstance, mechaDir: string): void {
  // --- List directory ---
  app.get("/bots/:name/files", async (
    request: FastifyRequest<{
      Params: { name: string };
      Querystring: { path?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;

    const botDir = join(mechaDir, botName);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${botName}` });
      return;
    }

    const config = readBotConfig(botDir);
    const homeDir = resolveBotHome(mechaDir, botName, config?.home);
    const relPath = request.query.path ?? "";

    try {
      const entries = await listBotDir(homeDir, relPath);
      return { home: homeDir, path: relPath, entries };
    } catch (err) {
      if (err instanceof PathTraversalError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // --- Read markdown file ---
  app.get("/bots/:name/files/read", async (
    request: FastifyRequest<{
      Params: { name: string };
      Querystring: { path: string };
    }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;

    const botDir = join(mechaDir, botName);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${botName}` });
      return;
    }

    const config = readBotConfig(botDir);
    const homeDir = resolveBotHome(mechaDir, botName, config?.home);
    const relPath = request.query.path;

    if (!relPath) {
      reply.code(400).send({ error: "Missing required query parameter: path" });
      return;
    }

    try {
      const content = await readBotFile(homeDir, relPath);
      return { path: relPath, content };
    } catch (err) {
      if (err instanceof PathTraversalError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      if (err instanceof FileNotFoundError) {
        reply.code(404).send({ error: err.message });
        return;
      }
      if (err instanceof NotMarkdownError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      if (err instanceof FileTooLargeError) {
        reply.code(413).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // --- Write markdown file (6 MB body limit to allow JSON envelope overhead) ---
  app.put("/bots/:name/files/write", {
    config: { bodyLimit: 6_291_456 },
  } as object, async (
    request: FastifyRequest<{
      Params: { name: string };
      Body: { path: string; content: string };
    }>,
    reply: FastifyReply,
  ) => {
    const botName = validateName(request.params.name, reply);
    if (!botName) return;

    const botDir = join(mechaDir, botName);
    if (!existsSync(botDir)) {
      reply.code(404).send({ error: `Bot not found: ${botName}` });
      return;
    }

    /* v8 ignore start -- Fastify always parses body for PUT */
    const body = request.body ?? {} as { path: string; content: string };
    /* v8 ignore stop */
    if (!body.path || typeof body.path !== "string") {
      reply.code(400).send({ error: "Missing required field: path" });
      return;
    }
    if (typeof body.content !== "string") {
      reply.code(400).send({ error: "Missing required field: content (must be a string)" });
      return;
    }

    const config = readBotConfig(botDir);
    const homeDir = resolveBotHome(mechaDir, botName, config?.home);

    try {
      await writeBotFile(homeDir, body.path, body.content);
      return { ok: true, path: body.path };
    } catch (err) {
      if (err instanceof PathTraversalError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      if (err instanceof NotMarkdownError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      if (err instanceof FileTooLargeError) {
        reply.code(413).send({ error: err.message });
        return;
      }
      throw err;
    }
  });
}
