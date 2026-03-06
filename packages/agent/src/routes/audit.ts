import type { FastifyInstance, FastifyRequest } from "fastify";
import { createAuditLog } from "@mecha/mcp-server";

/** Options for audit log route registration. */
export interface AuditRouteOpts {
  mechaDir: string;
}

/** Register GET /audit to retrieve MCP audit log entries with optional limit. */
export function registerAuditRoutes(app: FastifyInstance, opts: AuditRouteOpts): void {
  app.get("/audit", async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const limitParam = request.query.limit;
    const parsed = limitParam ? parseInt(limitParam, 10) : 50;
    const limit = isNaN(parsed) ? 50 : Math.max(1, Math.min(parsed, 1000));
    const audit = createAuditLog(opts.mechaDir);
    return audit.read({ limit });
  });
}
