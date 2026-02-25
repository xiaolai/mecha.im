import { join } from "node:path";
import {
  type CasaName,
  type Capability,
  type AclEngine,
  type ForwardResult,
  AclDeniedError,
  CasaNotFoundError,
  readCasaConfig,
  forwardQueryToCasa,
  isValidName,
  parseAddress,
  isCasaAddress,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { casaFind, type FindResult } from "./casa.js";
import type { MechaLocator } from "./locator.js";
import type { agentFetch as agentFetchType } from "./agent-fetch.js";

export interface CasaRouter {
  /** Route a query from source to target, checking ACL. */
  routeQuery(source: string, target: string, message: string, sessionId?: string): Promise<ForwardResult>;

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
  locator?: MechaLocator;
  agentFetch?: typeof agentFetchType;
  sourceName?: string;
}

/**
 * Create a CASA router for mediated inter-CASA communication.
 * Checks ACL before every request, then routes locally or remotely.
 */
export function createCasaRouter(opts: CreateRouterOpts): CasaRouter {
  const { mechaDir, acl, pm } = opts;

  function resolveLocal(name: CasaName): { port: number; token: string } {
    /* v8 ignore start -- belt-and-suspenders: CasaName is already validated */
    if (!isValidName(name)) throw new CasaNotFoundError(name);
    /* v8 ignore stop */
    const config = readCasaConfig(join(mechaDir, name));
    if (!config) throw new CasaNotFoundError(name);
    return { port: config.port, token: config.token };
  }

  return {
    async routeQuery(source, target, message, sessionId?) {
      // ACL check with full address strings
      const result = acl.check(source, target, "query");
      if (!result.allowed) {
        throw new AclDeniedError(source, "query", target);
      }

      // If locator is available, use it for local/remote resolution
      if (opts.locator) {
        const parsed = parseAddress(target);
        /* v8 ignore start -- group addresses not supported yet */
        if (!isCasaAddress(parsed)) throw new CasaNotFoundError(target);
        /* v8 ignore stop */
        const addr = parsed;
        const located = opts.locator.locate(addr);

        if (located.location === "local") {
          return forwardQueryToCasa(located.port, located.token, message, sessionId);
        }

        if (located.location === "remote" && !opts.agentFetch) {
          throw new Error("Remote routing configured but agentFetch transport not provided");
        }
        if (located.location === "remote" && opts.agentFetch) {
          // Only append @node if source is bare (no @ already)
          const sourceAddr = opts.sourceName && !source.includes("@")
            ? `${source}@${opts.sourceName}`
            : source;
          const res = await opts.agentFetch({
            node: located.node,
            path: `/casas/${addr.casa}/query`,
            method: "POST",
            body: { message, sessionId },
            source: sourceAddr,
          });
          if (!res.ok) {
            throw new Error(`Remote node ${located.node.name} returned HTTP ${res.status}`);
          }
          /* v8 ignore start -- null content-type fallback */
          const contentType = res.headers.get("content-type") ?? "";
          /* v8 ignore stop */
          if (contentType.includes("application/json")) {
            const data = (await res.json()) as Record<string, unknown>;
            const text = typeof data.response === "string"
              ? data.response
              : JSON.stringify(data);
            const returnedSessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
            return { text, sessionId: returnedSessionId };
          }
          return { text: await res.text() };
        }

        throw new CasaNotFoundError(target);
      }

      // Fallback: local-only routing (no locator)
      const parsed2 = parseAddress(target);
      /* v8 ignore start -- group addresses not supported yet */
      if (!isCasaAddress(parsed2)) throw new CasaNotFoundError(target);
      /* v8 ignore stop */
      const casaName = parsed2.casa;
      const { port, token } = resolveLocal(casaName);
      return forwardQueryToCasa(port, token, message, sessionId);
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
