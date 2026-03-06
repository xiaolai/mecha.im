import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { join } from "node:path";
import { readBudgets, writeBudgets, setBudget, removeBudget } from "@mecha/meter";

/** Options for budget route registration. */
export interface BudgetRouteOpts {
  mechaDir: string;
}

/** Register GET/POST/DELETE /budgets for budget management. */
export function registerBudgetRoutes(app: FastifyInstance, opts: BudgetRouteOpts): void {
  const meterDir = join(opts.mechaDir, "meter");

  app.get("/budgets", async () => {
    return readBudgets(meterDir);
  });

  app.post("/budgets", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as {
      scope?: string;
      name?: string;
      daily?: number;
      monthly?: number;
    };

    if (!body.scope) {
      reply.code(400).send({ error: "scope is required (global, bot, auth-profile, tag)" });
      return;
    }
    if (body.scope !== "global" && !body.name) {
      reply.code(400).send({ error: "name is required for non-global scopes" });
      return;
    }
    if (body.daily === undefined && body.monthly === undefined) {
      reply.code(400).send({ error: "at least one of daily or monthly is required" });
      return;
    }

    const target = parseTarget(body.scope, body.name);
    if (!target) {
      reply.code(400).send({ error: `Invalid scope: ${body.scope}` });
      return;
    }

    const config = readBudgets(meterDir);
    setBudget(config, target, body.daily, body.monthly);
    writeBudgets(meterDir, config);
    return { ok: true };
  });

  app.delete(
    "/budgets",
    async (
      request: FastifyRequest<{ Querystring: { scope?: string; name?: string; period?: string } }>,
      reply: FastifyReply,
    ) => {
      const { scope, name, period } = request.query;
      if (!scope || !period) {
        reply.code(400).send({ error: "scope and period query params required" });
        return;
      }
      if (period !== "daily" && period !== "monthly") {
        reply.code(400).send({ error: "period must be daily or monthly" });
        return;
      }
      if (scope !== "global" && !name) {
        reply.code(400).send({ error: "name is required for non-global scopes" });
        return;
      }

      const target = parseTarget(scope, name);
      if (!target) {
        reply.code(400).send({ error: `Invalid scope: ${scope}` });
        return;
      }

      const config = readBudgets(meterDir);
      const removed = removeBudget(config, target, period as "daily" | "monthly");
      if (!removed) {
        reply.code(404).send({ error: "Budget not found" });
        return;
      }
      writeBudgets(meterDir, config);
      return { ok: true };
    },
  );
}

function parseTarget(scope: string, name?: string) {
  switch (scope) {
    case "global":
      return { type: "global" as const };
    case "bot":
      /* v8 ignore start -- name is validated before parseTarget is called */
      return name ? { type: "bot" as const, name } : null;
    /* v8 ignore stop */
    case "auth-profile":
      /* v8 ignore start -- name is validated before parseTarget is called */
      return name ? { type: "auth" as const, name } : null;
    /* v8 ignore stop */
    case "tag":
      /* v8 ignore start -- name is validated before parseTarget is called */
      return name ? { type: "tag" as const, name } : null;
    /* v8 ignore stop */
    default:
      return null;
  }
}
