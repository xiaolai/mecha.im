import type { FastifyInstance } from "fastify";
import type { AclEngine } from "@mecha/core";

export interface AclRouteOpts {
  acl: AclEngine;
}

export function registerAclRoutes(app: FastifyInstance, opts: AclRouteOpts): void {
  app.get("/acl", async () => {
    return opts.acl.listRules();
  });
}
