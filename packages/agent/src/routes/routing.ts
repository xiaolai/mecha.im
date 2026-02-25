import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  type AclEngine,
  type Capability,
  AclDeniedError,
  CasaNotFoundError,
  readCasaConfig,
  forwardQueryToCasa,
  isValidName,
} from "@mecha/core";
import { join } from "node:path";
import { getSource } from "../auth.js";

export interface RoutingRouteOpts {
  mechaDir: string;
  acl: AclEngine;
}

export function registerRoutingRoutes(app: FastifyInstance, opts: RoutingRouteOpts): void {
  const { mechaDir, acl } = opts;

  app.post(
    "/casas/:name/query",
    async (
      request: FastifyRequest<{ Params: { name: string }; Body: { message: string; sessionId?: string } }>,
      reply: FastifyReply,
    ) => {
      const target = request.params.name;
      /* v8 ignore start -- Fastify always parses POST body; ?? is defensive */
      const { message, sessionId } = request.body ?? {};
      /* v8 ignore stop */
      const source = getSource(request);

      if (!source) {
        reply.code(400).send({ error: "Missing required header: X-Mecha-Source" });
        return;
      }

      if (typeof message !== "string" || !message) {
        reply.code(400).send({ error: "Missing required field: message (string)" });
        return;
      }

      if (!isValidName(target)) {
        reply.code(400).send({ error: `Invalid CASA name: ${target}` });
        return;
      }

      // ACL check — always enforced
      const aclResult = acl.check(source, target, "query" as Capability);
      if (!aclResult.allowed) {
        reply.code(403).send({ error: new AclDeniedError(source, "query", target).message });
        return;
      }

      const config = readCasaConfig(join(mechaDir, target));
      if (!config) {
        reply.code(404).send({ error: new CasaNotFoundError(target).message });
        return;
      }

      try {
        const fwd = await forwardQueryToCasa(config.port, config.token, message, sessionId);
        return { response: fwd.text, sessionId: fwd.sessionId };
      } catch {
        reply.code(502).send({ error: "Upstream CASA unavailable" });
      }
    },
  );
}
