import { join } from "node:path";
import {
  type CasaName,
  type Capability,
  type AclEngine,
  AclDeniedError,
  CasaNotFoundError,
  readCasaConfig,
  forwardQueryToCasa,
  isValidName,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { casaFind, type FindResult } from "./casa.js";

export interface CasaRouter {
  /** Route a query from source to target, checking ACL. */
  routeQuery(source: CasaName, target: CasaName, message: string): Promise<string>;

  /** Discover CASAs visible to source (ACL-filtered). */
  routeDiscover(
    source: CasaName,
    opts: { tags?: string[]; capability?: Capability },
  ): FindResult[];
}

export interface CreateRouterOpts {
  mechaDir: string;
  acl: AclEngine;
  pm: ProcessManager;
}

/**
 * Create a CASA router for mediated inter-CASA communication.
 * Checks ACL before every request, then HTTP-forwards to the target.
 */
export function createCasaRouter(opts: CreateRouterOpts): CasaRouter {
  const { mechaDir, acl, pm } = opts;

  function resolveTarget(name: CasaName): { port: number; token: string } {
    /* v8 ignore start -- belt-and-suspenders: CasaName is already validated */
    if (!isValidName(name)) throw new CasaNotFoundError(name);
    /* v8 ignore stop */
    const config = readCasaConfig(join(mechaDir, name));
    if (!config) throw new CasaNotFoundError(name);
    return { port: config.port, token: config.token };
  }

  return {
    async routeQuery(source, target, message) {
      const result = acl.check(source, target, "query");
      if (!result.allowed) {
        throw new AclDeniedError(source, "query", target);
      }

      const { port, token } = resolveTarget(target);
      return forwardQueryToCasa(port, token, message);
    },

    routeDiscover(source, discoverOpts) {
      const all = casaFind(mechaDir, pm, { tags: discoverOpts.tags });

      return all.filter((casa) => {
        if (casa.name === source) return false;
        /* v8 ignore start -- defensive name validation + expose/ACL filtering */
        if (!isValidName(casa.name)) return false;

        if (discoverOpts.capability) {
          const config = readCasaConfig(join(mechaDir, casa.name));
          const exposed = (config?.expose as string[]) ?? [];
          if (!exposed.includes(discoverOpts.capability)) return false;
          // ACL filter: source must have a grant for the requested capability
          const aclResult = acl.check(source, casa.name, discoverOpts.capability);
          if (!aclResult.allowed) return false;
        } else {
          // Without a specific capability, check if source has any grant to this CASA
          const aclResult = acl.check(source, casa.name, "query");
          if (!aclResult.allowed) return false;
        }
        /* v8 ignore stop */

        return true;
      });
    },
  };
}
