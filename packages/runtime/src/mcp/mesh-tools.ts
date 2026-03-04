import { promises as fsp } from "node:fs";
import { join } from "node:path";
import {
  type ForwardResult,
  type DiscoveryIndex,
  isCapability,
  matchesDiscoveryFilter,
  AclDeniedError,
  BotNotFoundError,
  createLogger,
} from "@mecha/core";

const log = createLogger("mecha:runtime:mesh");

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MESH_TOOLS: McpToolDef[] = [
  {
    name: "mesh_query",
    description: "Send a message to another bot and get a response",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target bot name or address (name@node)" },
        message: { type: "string", description: "Message to send" },
        sessionId: { type: "string", description: "Session ID for multi-turn conversations (optional)" },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "mesh_discover",
    description: "Find other bots by tag or capability",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        capability: { type: "string", description: "Filter by exposed capability" },
      },
    },
  },
];

/** Router interface — matches BotRouter.routeQuery signature */
export interface MeshRouter {
  routeQuery(
    source: string,
    target: string,
    message: string,
    sessionId?: string,
  ): Promise<ForwardResult>;
}

export interface MeshOpts {
  mechaDir: string;
  botName: string;
  router?: MeshRouter;
}

interface MeshResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/** Discover bots by reading discovery.json (fast, sandboxed-friendly). */
async function discoverBots(
  mechaDir: string,
  source: string,
  opts: { tag?: string; capability?: string },
): Promise<Array<{ name: string; tags: string[]; expose: string[]; state: string }>> {
  const indexPath = join(mechaDir, "discovery.json");
  let index: DiscoveryIndex;
  try {
    const raw = await fsp.readFile(indexPath, "utf-8");
    index = JSON.parse(raw) as DiscoveryIndex;
  /* v8 ignore start -- missing or corrupt discovery.json */
  } catch {
    return [];
  }
  /* v8 ignore stop */

  /* v8 ignore start -- defensive: malformed index shape */
  if (!Array.isArray(index.bots)) return [];
  /* v8 ignore stop */

  const results: Array<{ name: string; tags: string[]; expose: string[]; state: string }> = [];
  for (const entry of index.bots) {
    if (entry.name === source) continue;
    /* v8 ignore start -- defensive: normalize tags/expose/state from index */
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const expose = Array.isArray(entry.expose) ? entry.expose : [];
    const state = entry.state ?? "unknown";
    /* v8 ignore stop */
    // Only return running bots for discovery
    if (state !== "running") continue;
    if (!matchesDiscoveryFilter({ tags, expose }, opts)) continue;
    results.push({ name: entry.name, tags, expose, state });
  }

  return results;
}

export async function handleMeshTool(
  opts: MeshOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<MeshResult> {
  const { mechaDir, botName } = opts;

  switch (name) {
    case "mesh_query": {
      const target = args.target;
      const message = args.message;
      if (typeof target !== "string" || !target) {
        return { content: [{ type: "text", text: "Missing required: target (string)" }], isError: true };
      }
      if (typeof message !== "string" || !message) {
        return { content: [{ type: "text", text: "Missing required: message (string)" }], isError: true };
      }
      const rawSessionId = args.sessionId;
      if (rawSessionId !== undefined && typeof rawSessionId !== "string") {
        return { content: [{ type: "text", text: "sessionId must be a string" }], isError: true };
      }
      const sessionId = rawSessionId as string | undefined;

      if (!opts.router) {
        return { content: [{ type: "text", text: "Mesh routing not available" }], isError: true };
      }

      try {
        const fwd = await opts.router.routeQuery(botName, target, message, sessionId);
        const result: MeshResult = { content: [{ type: "text", text: fwd.text }] };
        if (fwd.sessionId) result._meta = { sessionId: fwd.sessionId };
        return result;
      } catch (err) {
        if (err instanceof AclDeniedError) {
          return { content: [{ type: "text", text: `Access denied: ${err.message}` }], isError: true };
        }
        if (err instanceof BotNotFoundError) {
          return { content: [{ type: "text", text: `bot not found: ${target}` }], isError: true };
        }
        /* v8 ignore start -- generic error fallback for unexpected forwarding failures */
        const detail = err instanceof Error ? err.message : String(err);
        log.error("Mesh query failed", { target, error: detail });
        return {
          content: [{ type: "text", text: "Mesh query failed" }],
          isError: true,
        };
        /* v8 ignore stop */
      }
    }

    case "mesh_discover": {
      const tag = args.tag as string | undefined;
      const capability = args.capability as string | undefined;

      if (capability && !isCapability(capability)) {
        return { content: [{ type: "text", text: `Invalid capability: "${capability}"` }], isError: true };
      }

      const bots = await discoverBots(mechaDir, botName, { tag, capability });

      if (bots.length === 0) {
        return { content: [{ type: "text", text: "No matching bots found" }] };
      }

      const lines = bots.map((c) =>
        `${c.name}: tags=[${c.tags.join(", ")}] expose=[${c.expose.join(", ")}]`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown mesh tool: ${name}` }], isError: true };
  }
}
