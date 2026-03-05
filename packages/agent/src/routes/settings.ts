import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { DEFAULTS, readNodes, readDiscoveredNodes, readTotpSecret } from "@mecha/core";
import { mechaAuthLs, mechaAuthDefault, mechaAuthRm } from "@mecha/service";

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
