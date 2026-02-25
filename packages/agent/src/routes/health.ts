import type { FastifyInstance } from "fastify";

export interface HealthRouteOpts {
  nodeName: string;
  port: number;
}

export function registerHealthRoutes(app: FastifyInstance, opts: HealthRouteOpts): void {
  app.get("/healthz", async () => ({
    status: "ok",
    node: opts.nodeName,
  }));
}
