import type { FastifyInstance, FastifyRequest } from "fastify";
import { join } from "node:path";
import { queryCostToday, queryCostForBot } from "@mecha/meter";

export interface MeterRouteOpts {
  mechaDir: string;
}

export function registerMeterRoutes(app: FastifyInstance, opts: MeterRouteOpts): void {
  app.get("/meter/cost", async (request: FastifyRequest<{ Querystring: { bot?: string } }>) => {
    const meterDir = join(opts.mechaDir, "meter");
    const bot = request.query.bot;
    return bot
      ? queryCostForBot(meterDir, bot)
      : queryCostToday(meterDir);
  });
}
