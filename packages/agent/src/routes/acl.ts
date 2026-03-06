import type { FastifyInstance } from "fastify";
import type { AclEngine } from "@mecha/core";

/** Options for ACL route registration. */
export interface AclRouteOpts {
  acl: AclEngine;
}

/** Register GET /acl to list all access control rules. */
export function registerAclRoutes(app: FastifyInstance, opts: AclRouteOpts): void {
  app.get("/acl", async () => {
    return opts.acl.listRules();
  });
}
