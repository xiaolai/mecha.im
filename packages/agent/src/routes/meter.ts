import type { FastifyInstance, FastifyRequest } from "fastify";
import { join } from "node:path";
import { queryCostToday, queryCostForCasa } from "@mecha/meter";

export interface MeterRouteOpts {
  mechaDir: string;
}

export function registerMeterRoutes(app: FastifyInstance, opts: MeterRouteOpts): void {
  app.get("/meter/cost", async (request: FastifyRequest<{ Querystring: { casa?: string } }>) => {
    const meterDir = join(opts.mechaDir, "meter");
    const casa = request.query.casa;
    return casa
      ? queryCostForCasa(meterDir, casa)
      : queryCostToday(meterDir);
  });
}
