import type { FastifyInstance, FastifyRequest } from "fastify";
import { join } from "node:path";
import { queryCostToday, queryCostForBot, getMeterStatus } from "@mecha/meter";

/** Options for metering/cost route registration. */
export interface MeterRouteOpts {
  mechaDir: string;
}

/** Register GET /meter/cost and GET /meter/status routes. */
export function registerMeterRoutes(app: FastifyInstance, opts: MeterRouteOpts): void {
  app.get("/meter/cost", async (request: FastifyRequest<{ Querystring: { bot?: string } }>) => {
    const meterDir = join(opts.mechaDir, "meter");
    const bot = request.query.bot;
    return bot
      ? queryCostForBot(meterDir, bot)
      : queryCostToday(meterDir);
  });

  /** GET /meter/status — current meter daemon status. */
  app.get("/meter/status", async () => {
    const meterDir = join(opts.mechaDir, "meter");
    return getMeterStatus(meterDir);
  });
}
