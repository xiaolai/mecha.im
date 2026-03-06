import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  addPlugin,
  removePlugin,
  listPlugins,
  getPlugin,
  pluginName,
  PluginInputSchema,
  type PluginConfig,
  type StdioPluginConfig,
  type HttpPluginConfig,
} from "@mecha/core";

export interface PluginRouteOpts {
  mechaDir: string;
}

/** Check if a URL targets a private/internal address (SSRF guard). */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    // Only allow http/https protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    const h = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    // Block localhost variants
    if (h === "localhost" || h === "0.0.0.0" || h === "[::]") return true;
    // Block IPv6 loopback, link-local, ULA, and mapped private addresses
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("::ffff:")) return true; // IPv4-mapped IPv6 (any)
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
    // Block IPv4 private ranges
    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 127 || a === 10 || a === 0) return true;
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true; // link-local
    }
    return false;
  /* v8 ignore start -- malformed URL fallback */
  } catch { return true; }
  /* v8 ignore stop */
}

/** Register CRUD + test routes for plugin management. */
export function registerPluginRoutes(app: FastifyInstance, opts: PluginRouteOpts): void {
  const { mechaDir } = opts;

  /** GET /plugins — list all registered plugins. */
  app.get("/plugins", async () => {
    return listPlugins(mechaDir);
  });

  /** POST /plugins — add a new plugin. */
  app.post("/plugins", async (request: FastifyRequest, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as Record<string, unknown>;
    /* v8 ignore stop */

    // Validate name
    const rawName = body.name;
    if (typeof rawName !== "string" || rawName.length === 0) {
      return reply.code(400).send({ error: "name is required" });
    }
    const name = pluginName(rawName); // throws InvalidNameError or PluginNameReservedError → global handler

    // Validate input via Zod discriminated union
    const parsed = PluginInputSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      return reply.code(400).send({ error: msg });
    }

    const input = parsed.data;
    const now = new Date().toISOString();

    let config: PluginConfig;
    if (input.type === "stdio") {
      config = {
        type: "stdio",
        command: input.command,
        /* v8 ignore start -- optional field spread branches */
        ...(input.args ? { args: input.args } : {}),
        ...(input.env ? { env: input.env } : {}),
        ...(input.description ? { description: input.description } : {}),
        /* v8 ignore stop */
        addedAt: now,
      };
    } else {
      config = {
        type: input.type,
        url: input.url,
        /* v8 ignore start -- optional field spread branches */
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.description ? { description: input.description } : {}),
        /* v8 ignore stop */
        addedAt: now,
      };
    }

    const force = body.force === true;
    addPlugin(mechaDir, name, config, force);
    return { ok: true };
  });

  /** DELETE /plugins/:name — remove a plugin. */
  app.delete(
    "/plugins/:name",
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const removed = removePlugin(mechaDir, name);
      if (!removed) {
        return reply.code(404).send({ error: `Plugin not found: ${name}` });
      }
      return { ok: true };
    },
  );

  /** GET /plugins/:name/status — get a single plugin's config. */
  app.get(
    "/plugins/:name/status",
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const plugin = getPlugin(mechaDir, name);
      if (!plugin) {
        return reply.code(404).send({ error: `Plugin not found: ${name}` });
      }
      // Redact sensitive values (env vars, auth headers) — expose keys only
      const redacted = { ...plugin } as Record<string, unknown>;
      if (plugin.type === "stdio" && (plugin as StdioPluginConfig).env) {
        redacted.env = Object.fromEntries(Object.keys((plugin as StdioPluginConfig).env!).map((k) => [k, "***"]));
      }
      if ((plugin.type === "http" || plugin.type === "sse") && (plugin as HttpPluginConfig).headers) {
        redacted.headers = Object.fromEntries(Object.keys((plugin as HttpPluginConfig).headers!).map((k) => [k, "***"]));
      }
      return { name, config: redacted };
    },
  );

  /** POST /plugins/:name/test — basic connectivity test. */
  app.post(
    "/plugins/:name/test",
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const plugin = getPlugin(mechaDir, name);
      if (!plugin) {
        return reply.code(404).send({ error: `Plugin not found: ${name}` });
      }

      if (plugin.type === "http" || plugin.type === "sse") {
        const { url } = plugin as HttpPluginConfig;
        if (isPrivateUrl(url)) {
          return reply.code(400).send({ error: "Cannot test plugins targeting private/internal addresses" });
        }
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
          return { ok: res.ok, status: res.status };
        } catch {
          return { ok: false, error: "unreachable" };
        }
      }

      if (plugin.type === "stdio") {
        const { command } = plugin as StdioPluginConfig;
        return { ok: true, command, note: "stdio plugin — command existence not verified" };
      }

      /* v8 ignore start -- exhaustive fallback */
      return { ok: true };
      /* v8 ignore stop */
    },
  );
}
