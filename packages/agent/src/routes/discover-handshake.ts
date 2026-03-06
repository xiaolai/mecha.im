import type { FastifyInstance, FastifyRequest } from "fastify";
import { writeDiscoveredNode, safeCompare, type DiscoveredNode } from "@mecha/core";

export interface HandshakeRouteOpts {
  clusterKey: string;
  nodeName: string;
  port: number;
  mechaDir: string;
  meshApiKey?: string;
  fingerprint?: string;
}

interface HandshakeBody {
  clusterKey: string;
  nodeName: string;
  port: number;
  tailscaleIp?: string;
  lanIp?: string;
  fingerprint?: string;
}

function isValidBody(body: unknown): body is HandshakeBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.clusterKey === "string" && b.clusterKey.length > 0
    && typeof b.nodeName === "string" && b.nodeName.length > 0 && b.nodeName.length <= 64
    && typeof b.port === "number" && Number.isInteger(b.port) && b.port >= 1 && b.port <= 65535;
}


export function registerHandshakeRoute(app: FastifyInstance, opts: HandshakeRouteOpts): void {
  app.post(
    "/discover/handshake",
    async (request: FastifyRequest<{ Body: HandshakeBody }>, reply) => {
      if (!isValidBody(request.body)) {
        return reply.code(400).send({ error: "Missing required fields" });
      }
      const body = request.body;

      if (!safeCompare(body.clusterKey, opts.clusterKey)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      if (body.nodeName === opts.nodeName) {
        return reply.code(409).send({ error: "Self-discovery" });
      }

      const host = body.tailscaleIp ?? body.lanIp ?? request.ip;

      const discovered: DiscoveredNode = {
        name: body.nodeName,
        host,
        port: body.port,
        apiKey: "",
        fingerprint: body.fingerprint,
        source: body.tailscaleIp ? "tailscale" : "mdns",
        lastSeen: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      };
      writeDiscoveredNode(opts.mechaDir, discovered);

      return {
        accepted: true,
        nodeName: opts.nodeName,
        fingerprint: opts.fingerprint,
        port: opts.port,
        meshApiKey: opts.meshApiKey,
      };
    },
  );
}
