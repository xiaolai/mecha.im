import type { FastifyInstance, FastifyRequest } from "fastify";
import { readCasaConfig, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { join } from "node:path";

export interface DiscoverRouteOpts {
  mechaDir: string;
  pm: ProcessManager;
}

export function registerDiscoverRoutes(app: FastifyInstance, opts: DiscoverRouteOpts): void {
  app.get(
    "/discover",
    async (request: FastifyRequest<{ Querystring: { tag?: string; capability?: string } }>) => {
      const { tag, capability } = request.query;
      const list = opts.pm.list();

      const results = list
        .filter((p) => isValidName(p.name))
        .map((p) => {
          const config = readCasaConfig(join(opts.mechaDir, p.name));
          const rawTags = config?.tags;
          const rawExpose = config?.expose;
          const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === "string") : [];
          const expose = Array.isArray(rawExpose) ? rawExpose.filter((e): e is string => typeof e === "string") : [];
          return { name: p.name, state: p.state, tags, expose };
        })
        .filter((c) => {
          if (tag && !c.tags.includes(tag)) return false;
          if (capability && !c.expose.includes(capability)) return false;
          return true;
        });

      return results;
    },
  );
}
