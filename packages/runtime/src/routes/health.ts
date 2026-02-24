import type { FastifyInstance } from "fastify";

export interface HealthRouteOpts {
  casaName: string;
  port: number;
  startedAt: string;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  opts: HealthRouteOpts,
): void {
  app.get("/healthz", async () => {
    return { status: "ok" };
  });

  app.get("/info", async () => {
    return {
      name: opts.casaName,
      port: opts.port,
      startedAt: opts.startedAt,
      uptime: process.uptime(),
    };
  });
}
