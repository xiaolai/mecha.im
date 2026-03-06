import type { FastifyInstance, FastifyRequest } from "fastify";
import { writeDiscoveredNode, safeCompare, isValidName, type DiscoveredNode } from "@mecha/core";

/** Options for the auto-discovery handshake route. */
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
    && typeof b.nodeName === "string" && isValidName(b.nodeName)
    && typeof b.port === "number" && Number.isInteger(b.port) && b.port >= 1 && b.port <= 65535;
}


/** Register POST /discover/handshake for cluster key-authenticated peer discovery. */
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

      // Validate IP fields — dotted-decimal IPv4 (1-3 digits per octet, 4 octets) or hex-colon IPv6
      const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Re = /^[a-f\d:]{2,39}$/i;
      const isValidIp = (s: string) => ipv4Re.test(s) || ipv6Re.test(s);
      if (body.tailscaleIp && (typeof body.tailscaleIp !== "string" || !isValidIp(body.tailscaleIp))) {
        return reply.code(400).send({ error: "Invalid tailscaleIp format" });
      }
      if (body.lanIp && (typeof body.lanIp !== "string" || !isValidIp(body.lanIp))) {
        return reply.code(400).send({ error: "Invalid lanIp format" });
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
