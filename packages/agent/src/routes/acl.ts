import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type AclEngine, isCapability, type Capability } from "@mecha/core";

/** Options for ACL route registration. */
export interface AclRouteOpts {
  acl: AclEngine;
}

/** Register ACL routes: GET /acl, POST /acl/grant, POST /acl/revoke. */
export function registerAclRoutes(app: FastifyInstance, opts: AclRouteOpts): void {
  app.get("/acl", async () => {
    return opts.acl.listRules();
  });

  app.post("/acl/grant", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { source?: string; target?: string; capability?: string };
    if (!body.source || !body.target || !body.capability) {
      reply.code(400).send({ error: "source, target, and capability are required" });
      return;
    }
    if (!isCapability(body.capability)) {
      reply.code(400).send({ error: `Invalid capability: ${body.capability}. Valid: query, read_workspace, write_workspace, execute, read_sessions, lifecycle` });
      return;
    }
    opts.acl.grant(body.source, body.target, [body.capability as Capability]);
    opts.acl.save();
    return { ok: true };
  });

  app.post("/acl/revoke", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { source?: string; target?: string; capability?: string };
    if (!body.source || !body.target || !body.capability) {
      reply.code(400).send({ error: "source, target, and capability are required" });
      return;
    }
    if (!isCapability(body.capability)) {
      reply.code(400).send({ error: `Invalid capability: ${body.capability}` });
      return;
    }
    opts.acl.revoke(body.source, body.target, [body.capability as Capability]);
    opts.acl.save();
    return { ok: true };
  });
}
