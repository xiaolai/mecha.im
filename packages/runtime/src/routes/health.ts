import type { FastifyInstance } from "fastify";

export interface HealthRouteOpts {
  botName: string;
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
    const mem = process.memoryUsage();
    return {
      name: opts.botName,
      port: opts.port,
      startedAt: opts.startedAt,
      uptime: process.uptime(),
      memoryMB: Math.floor(mem.rss / 1_048_576),
    };
  });
}
