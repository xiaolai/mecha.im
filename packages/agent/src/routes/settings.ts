import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { DEFAULTS, readNodes, readDiscoveredNodes, readTotpSecret, AuthProfileAlreadyExistsError, AuthProfileNotFoundError } from "@mecha/core";
import { mechaAuthLs, mechaAuthDefault, mechaAuthRm, mechaAuthAddFull, mechaAuthRenew, mechaAuthProbe } from "@mecha/service";

export interface SettingsRouteOpts {
  mechaDir: string;
}

const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);

/** Profile names must be non-empty alphanumeric/dash/underscore strings, not reserved keys. */
function isValidProfileName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0
    && /^[\w][\w\-.]*$/.test(name)
    && !RESERVED_NAMES.has(name);
}

/** Detect TOTP source by checking file existence before env fallback. */
function detectTotpSource(mechaDir: string): "file" | "env" | null {
  const filePath = join(mechaDir, "totp-secret");
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (content) return "file";
  /* v8 ignore start -- non-ENOENT errors are filesystem-dependent */
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  /* v8 ignore stop */
  if (process.env.MECHA_OTP?.trim()) return "env";
  return null;
}

/** GET /settings/runtime — port ranges, agent port, MCP port, discovery status. */
export function registerSettingsRoutes(app: FastifyInstance, opts: SettingsRouteOpts): void {
  app.get("/settings/runtime", async () => {
    const manualNodes = readNodes(opts.mechaDir);
    const discoveredNodes = readDiscoveredNodes(opts.mechaDir);
    const clusterKeySet = Boolean(process.env.MECHA_CLUSTER_KEY);

    return {
      botPortRange: `${DEFAULTS.RUNTIME_PORT_BASE}-${DEFAULTS.RUNTIME_PORT_MAX}`,
      agentPort: DEFAULTS.AGENT_PORT,
      mcpPort: DEFAULTS.MCP_HTTP_PORT,
      discovery: {
        enabled: clusterKeySet,
        discoveredCount: discoveredNodes.length,
        manualCount: manualNodes.length,
      },
    };
  });

  /** GET /settings/totp — whether TOTP is configured and its source. */
  app.get("/settings/totp", async () => {
    const secret = readTotpSecret(opts.mechaDir);
    const source = secret !== null ? detectTotpSource(opts.mechaDir) : null;
    return { configured: secret !== null, source };
  });

  /** GET /settings/auth-profiles — list all stored + env-sourced profiles. */
  app.get("/settings/auth-profiles", async () => {
    return mechaAuthLs(opts.mechaDir);
  });

  /** POST /settings/auth-profiles/default — set the default auth profile. */
  app.post<{ Body: { name: string } }>("/settings/auth-profiles/default", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const name = body?.name;
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Missing or invalid profile name" });
    }
    mechaAuthDefault(opts.mechaDir, name);
    return { ok: true };
  });

  /** POST /settings/auth-profiles — create a new auth profile. */
  app.post<{ Body: { name: string; type: string; token: string } }>("/settings/auth-profiles", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const name = body?.name;
    const type = body?.type;
    const token = body?.token;
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Missing or invalid profile name" });
    }
    if (type !== "oauth" && type !== "api-key") {
      return reply.code(400).send({ error: "Type must be 'oauth' or 'api-key'" });
    }
    if (typeof token !== "string" || token.length === 0) {
      return reply.code(400).send({ error: "Token is required" });
    }
    try {
      const profile = mechaAuthAddFull(opts.mechaDir, { name, type, token });
      return profile;
    } catch (err) {
      if (err instanceof AuthProfileAlreadyExistsError) {
        return reply.code(409).send({ error: `Profile '${name}' already exists` });
      }
      throw err;
    }
  });

  /** PATCH /settings/auth-profiles/:name — renew token for an existing profile. */
  app.patch<{ Params: { name: string }; Body: { token: string } }>("/settings/auth-profiles/:name", async (request, reply) => {
    const { name } = request.params;
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Invalid profile name" });
    }
    const body = request.body as Record<string, unknown> | null;
    const token = body?.token;
    if (typeof token !== "string" || token.length === 0) {
      return reply.code(400).send({ error: "Token is required" });
    }
    try {
      const profile = mechaAuthRenew(opts.mechaDir, name, token);
      return profile;
    } catch (err) {
      if (err instanceof AuthProfileNotFoundError) {
        return reply.code(404).send({ error: `Profile '${name}' not found` });
      }
      throw err;
    }
  });

  /** POST /settings/auth-profiles/:name/test — probe token validity against Anthropic API. */
  app.post<{ Params: { name: string } }>("/settings/auth-profiles/:name/test", async (request, reply) => {
    const { name } = request.params;
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Invalid profile name" });
    }
    try {
      const result = await mechaAuthProbe(opts.mechaDir, name);
      return { valid: result.valid, error: result.error };
    } catch (err) {
      if (err instanceof AuthProfileNotFoundError) {
        return reply.code(404).send({ error: `Profile '${name}' not found` });
      }
      throw err;
    }
  });

  /** DELETE /settings/auth-profiles/:name — remove a stored profile. */
  app.delete<{ Params: { name: string } }>("/settings/auth-profiles/:name", async (request, reply) => {
    const { name } = request.params;
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Invalid profile name" });
    }
    if (name.startsWith("$env:")) {
      return reply.code(400).send({ error: "Cannot remove environment-sourced profiles" });
    }
    mechaAuthRm(opts.mechaDir, name);
    return { ok: true };
  });
}
