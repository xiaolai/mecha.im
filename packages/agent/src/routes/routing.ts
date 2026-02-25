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

      if (!message) {
        reply.code(400).send({ error: "Missing required field: message" });
        return;
      }

      if (!isValidName(target)) {
        reply.code(400).send({ error: `Invalid CASA name: ${target}` });
        return;
      }

      // ACL check if source provided
      if (source) {
        const result = acl.check(source, target, "query" as Capability);
        if (!result.allowed) {
          reply.code(403).send({ error: new AclDeniedError(source, "query", target).message });
          return;
        }
      }

      const config = readCasaConfig(join(mechaDir, target));
      if (!config) {
        reply.code(404).send({ error: new CasaNotFoundError(target).message });
        return;
      }

      const fwd = await forwardQueryToCasa(config.port, config.token, message, sessionId);
      return { response: fwd.text, sessionId: fwd.sessionId };
    },
  );
}
