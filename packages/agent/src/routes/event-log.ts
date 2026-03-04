import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EventLog } from "../event-log.js";

export interface EventLogRouteOpts {
  eventLog: EventLog;
}

export function registerEventLogRoutes(app: FastifyInstance, opts: EventLogRouteOpts): void {
  app.get("/events/log", async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const limitParam = request.query.limit;
    const parsed = limitParam ? parseInt(limitParam, 10) : 100;
    const limit = isNaN(parsed) ? 100 : Math.max(1, Math.min(parsed, 1000));
    return opts.eventLog.read({ limit });
  });
}
