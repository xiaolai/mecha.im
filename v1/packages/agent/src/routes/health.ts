import { hostname } from "node:os";
import type { FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import type { NodeHealth } from "../heartbeat.js";

export interface HealthDeps {
  pm: ProcessManager;
  startedAt: number;
  getNodeHealth: () => NodeHealth[];
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get("/healthz", async () => {
    let mechaCount = 0;
    try {
      mechaCount = deps.pm.list().length;
    } catch {
      // ProcessManager may fail; still report healthy
    }
    const uptimeSeconds = Math.floor((Date.now() - deps.startedAt) / 1000);
    return {
      status: "ok",
      node: hostname(),
      mechaCount,
      uptime: uptimeSeconds,
    };
  });

  app.get("/nodes/health", async () => {
    return deps.getNodeHealth();
  });
}
