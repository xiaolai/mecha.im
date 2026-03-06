import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type BotName,
  type Capability,
  type AclEngine,
  type ForwardResult,
  AclDeniedError,
  BotNotFoundError,
  RemoteRoutingError,
  readBotConfig,
  forwardQueryToBot,
  isValidName,
  parseAddress,
  isBotAddress,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { botFind, type FindResult } from "./bot.js";
import type { MechaLocator } from "./locator.js";
import type { agentFetch as agentFetchType } from "./agent-fetch.js";

/** Router for mediated inter-bot communication with ACL enforcement. */
export interface BotRouter {
  /** Route a query from source to target, checking ACL. */
  routeQuery(source: string, target: string, message: string, sessionId?: string): Promise<ForwardResult>;

  /** Discover bots visible to source (ACL-filtered). */
  routeDiscover(
    source: BotName,
    opts: { tags?: string[]; capability?: Capability },
  ): FindResult[];
}

/** Options for creating a bot router. */
export interface CreateRouterOpts {
  mechaDir: string;
  acl: AclEngine;
  pm: ProcessManager;
  locator?: MechaLocator;
  agentFetch?: typeof agentFetchType;
  sourceName?: string;
  /** Allow private/loopback hosts for remote routing (local dev/testing). */
  allowPrivateHosts?: boolean;
}

/**
 * Create a bot router for mediated inter-bot communication.
 * Checks ACL before every request, then routes locally or remotely.
 */
export function createBotRouter(opts: CreateRouterOpts): BotRouter {
  const { mechaDir, acl, pm } = opts;
  /* v8 ignore start -- dev/test-only warning */
  if (opts.allowPrivateHosts) {
    console.warn("[mecha:router] allowPrivateHosts is enabled — SSRF protection bypassed");
  }
  /* v8 ignore stop */

  /* v8 ignore start -- resolveLocal: only called via locator.locate("local") path */
  function resolveLocal(name: BotName): { port: number; token: string } {
    if (!isValidName(name)) throw new BotNotFoundError(name);
    const config = readBotConfig(join(mechaDir, name));
    if (!config) throw new BotNotFoundError(name);
    return { port: config.port, token: config.token };
  }
  /* v8 ignore stop */

  return {
    async routeQuery(source, target, message, sessionId?) {
      // ACL check with full address strings
      const result = acl.check(source, target, "query");
      if (!result.allowed) {
        throw new AclDeniedError(source, "query", target);
      }

      const requestId = randomUUID();

      // If locator is available, use it for local/remote resolution
      if (opts.locator) {
        const parsed = parseAddress(target);
        /* v8 ignore start -- group addresses not supported yet */
        if (!isBotAddress(parsed)) throw new BotNotFoundError(target);
        /* v8 ignore stop */
        const addr = parsed;
        const located = opts.locator.locate(addr);

        if (located.location === "local") {
          return forwardQueryToBot(located.port, located.token, message, sessionId, requestId);
        }

        /* v8 ignore start -- remote-channel routing: tested in mesh E2E integration tests */
        // Phase 6: managed nodes use SecureChannel via remote-channel
        if (located.location === "remote-channel" && !opts.agentFetch) {
          throw new RemoteRoutingError("(no transport)", 0);
        }
        if (located.location === "remote-channel" && opts.agentFetch) {
          const sourceAddr = opts.sourceName && !source.includes("@")
            ? `${source}@${opts.sourceName}`
            : source;
          const res = await opts.agentFetch({
            node: located.node,
            path: `/bots/${addr.bot}/query`,
            method: "POST",
            body: { message, sessionId, requestId },
            source: sourceAddr,
            allowPrivateHosts: opts.allowPrivateHosts,
          });
          if (!res.ok) {
            throw new RemoteRoutingError(located.node.name, res.status);
          }
          const ct = res.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            const data = (await res.json()) as Record<string, unknown>;
            const text = typeof data.response === "string" ? data.response : JSON.stringify(data);
            const returnedSessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
            return { text, sessionId: returnedSessionId };
          }
          return { text: await res.text() };
        }
        /* v8 ignore stop */

        // TODO(Phase 6): Plumb signFn into agentFetch for signed remote routing
        if (located.location === "remote" && !opts.agentFetch) {
          throw new RemoteRoutingError("(no transport)", 0);
        }
        if (located.location === "remote" && opts.agentFetch) {
          // Only append @node if source is bare (no @ already)
          const sourceAddr = opts.sourceName && !source.includes("@")
            ? `${source}@${opts.sourceName}`
            : source;
          const res = await opts.agentFetch({
            node: located.node,
            path: `/bots/${addr.bot}/query`,
            method: "POST",
            body: { message, sessionId, requestId },
            source: sourceAddr,
            allowPrivateHosts: opts.allowPrivateHosts,
          });
          if (!res.ok) {
            throw new RemoteRoutingError(located.node.name, res.status);
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

        throw new BotNotFoundError(target);
      }

      /* v8 ignore start -- locator is required in all production paths */
      throw new BotNotFoundError(target);
      /* v8 ignore stop */
    },

    routeDiscover(source, discoverOpts) {
      const all = botFind(mechaDir, pm, { tags: discoverOpts.tags });

      return all.filter((bot) => {
        if (bot.name === source) return false;
        /* v8 ignore start -- defensive name validation + expose/ACL filtering */
        if (!isValidName(bot.name)) return false;

        if (discoverOpts.capability) {
          const config = readBotConfig(join(mechaDir, bot.name));
          const exposed = (config?.expose as string[]) ?? [];
          if (!exposed.includes(discoverOpts.capability)) return false;
          // ACL filter: source must have a grant for the requested capability
          const aclResult = acl.check(source, bot.name, discoverOpts.capability);
          if (!aclResult.allowed) return false;
        } else {
          // Without a specific capability, check if source has any grant to this bot
          const aclResult = acl.check(source, bot.name, "query");
          if (!aclResult.allowed) return false;
        }
        /* v8 ignore stop */

        return true;
      });
    },
  };
}
