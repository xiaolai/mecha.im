import type { FastifyInstance, FastifyRequest } from "fastify";
import { writeDiscoveredNode, type DiscoveredNode } from "@mecha/core";
import { timingSafeEqual } from "node:crypto";

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

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerHandshakeRoute(app: FastifyInstance, opts: HandshakeRouteOpts): void {
  app.post(
    "/discover/handshake",
    async (request: FastifyRequest<{ Body: HandshakeBody }>, reply) => {
      const body = request.body;
      if (!body || !body.clusterKey || !body.nodeName || !body.port) {
        return reply.code(400).send({ error: "Missing required fields" });
      }

      if (!safeEqual(body.clusterKey, opts.clusterKey)) {
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
