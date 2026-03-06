import type { FastifyInstance } from "fastify";
import { collectNodeInfo } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

/** Options for health check route registration. */
export interface HealthRouteOpts {
  nodeName: string;
  port: number;
  processManager: ProcessManager;
  startedAt: string;
  publicIp?: string;
}

/** Register GET /healthz (public) and GET /node/info (authenticated system telemetry). */
export function registerHealthRoutes(app: FastifyInstance, opts: HealthRouteOpts): void {
  // Public endpoint — minimal response only
  app.get("/healthz", async () => ({
    status: "ok",
    node: opts.nodeName,
  }));

  // Authenticated endpoint — full system telemetry
  app.get("/node/info", async () => {
    const info = collectNodeInfo({
      port: opts.port,
      startedAt: opts.startedAt,
      botCount: opts.processManager.list().filter((p) => p.state === "running").length,
      publicIp: opts.publicIp,
    });
    return { node: opts.nodeName, ...info };
  });
}
