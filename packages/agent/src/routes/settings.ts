import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { DEFAULTS, readNodes, readDiscoveredNodes, readTotpSecret, readMechaSettings, writeMechaSettings, isValidProfileName as _isValidProfileName, isValidName, AuthProfileAlreadyExistsError, AuthProfileNotFoundError } from "@mecha/core";
import { readNodeName } from "@mecha/service";

/** Type-narrowing wrapper: validates unknown input is a valid profile name string. */
function isValidProfileName(name: unknown): name is string {
  return typeof name === "string" && _isValidProfileName(name);
}
import { mechaAuthLs, mechaAuthDefault, mechaAuthRm, mechaAuthAddFull, mechaAuthRenew, mechaAuthProbe } from "@mecha/service";

/** Options for settings route registration. */
export interface SettingsRouteOpts {
  mechaDir: string;
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

/** Register settings routes: runtime config, TOTP status, auth profiles CRUD, and network settings. */
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

  /** GET /settings/node — current node name. */
  app.get("/settings/node", async () => {
    const name = readNodeName(opts.mechaDir);
    return { name: name ?? null };
  });

  /** PATCH /settings/node — rename this node (requires restart to take effect on mesh). */
  app.patch<{ Body: { name: string } }>("/settings/node", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const name = body?.name;
    if (typeof name !== "string" || name.length === 0) {
      return reply.code(400).send({ error: "Node name is required" });
    }
    if (!isValidName(name)) {
      return reply.code(400).send({ error: "Invalid node name (lowercase a-z, 0-9, hyphens, 1-32 chars)" });
    }
    const existing = readNodeName(opts.mechaDir);
    if (existing === name) {
      return { name, changed: false };
    }
    const nodePath = join(opts.mechaDir, "node.json");
    const { writeFileSync } = await import("node:fs");
    const config = { name, createdAt: new Date().toISOString() };
    writeFileSync(nodePath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    return { name, changed: true, note: "Restart the agent for the new name to take effect on the mesh." };
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
    try {
      mechaAuthDefault(opts.mechaDir, name);
    } catch (err) {
      if (err instanceof AuthProfileNotFoundError) {
        return reply.code(404).send({ error: `Profile '${name}' not found` });
      }
      throw err;
    }
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
    if (token.length > 10_000) {
      return reply.code(400).send({ error: "Token too long (max 10000 chars)" });
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
    if (token.length > 10_000) {
      return reply.code(400).send({ error: "Token too long (max 10000 chars)" });
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

  /** GET /settings/network — current network settings (forceHttps). */
  app.get("/settings/network", async () => {
    const settings = readMechaSettings(opts.mechaDir);
    return { forceHttps: settings.forceHttps ?? false };
  });

  /** PATCH /settings/network — update network settings (forceHttps toggle). */
  app.patch<{ Body: { forceHttps?: boolean } }>("/settings/network", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (body == null || typeof body !== "object") {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    if ("forceHttps" in body && typeof body.forceHttps !== "boolean") {
      return reply.code(400).send({ error: "forceHttps must be a boolean" });
    }
    const current = readMechaSettings(opts.mechaDir);
    const updated = { ...current };
    if (typeof body.forceHttps === "boolean") {
      updated.forceHttps = body.forceHttps;
    }
    writeMechaSettings(opts.mechaDir, updated);
    return { forceHttps: updated.forceHttps ?? false };
  });

  /** DELETE /settings/auth-profiles/:name — remove a stored profile. */
  app.delete<{ Params: { name: string } }>("/settings/auth-profiles/:name", async (request, reply) => {
    const { name } = request.params;
    if (typeof name === "string" && name.startsWith("$env:")) {
      return reply.code(400).send({ error: "Cannot remove environment-sourced profiles" });
    }
    if (!isValidProfileName(name)) {
      return reply.code(400).send({ error: "Invalid profile name" });
    }
    mechaAuthRm(opts.mechaDir, name);
    return { ok: true };
  });
}
