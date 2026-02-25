import { promises as fsp } from "node:fs";
import { join } from "node:path";
import {
  type Capability,
  createAclEngine,
  readCasaConfig,
  forwardQueryToCasa,
  isValidName,
  isCapability,
} from "@mecha/core";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MESH_TOOLS: McpToolDef[] = [
  {
    name: "mesh_query",
    description: "Send a message to another CASA and get a response",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target CASA name" },
        message: { type: "string", description: "Message to send" },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "mesh_discover",
    description: "Find other CASAs by tag or capability",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        capability: { type: "string", description: "Filter by exposed capability" },
      },
    },
  },
];

export interface MeshOpts {
  mechaDir: string;
  casaName: string;
}

interface MeshResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Discover CASAs by scanning mechaDir (no ProcessManager needed). */
async function discoverCasas(
  mechaDir: string,
  source: string,
  opts: { tag?: string; capability?: string },
): Promise<Array<{ name: string; tags: string[]; expose: string[]; state: string }>> {
  let entries: string[];
  try {
    entries = await fsp.readdir(mechaDir);
  /* v8 ignore start -- readdir fallback */
  } catch {
    return [];
  }
  /* v8 ignore stop */

  const results: Array<{ name: string; tags: string[]; expose: string[]; state: string }> = [];

  for (const entry of entries) {
    if (entry === "identity" || entry === "tools" || entry === "auth") continue;
    /* v8 ignore start -- defensive: invalid names, non-dirs, missing configs */
    if (!isValidName(entry)) continue;
    if (entry === source) continue;

    try {
      const stat = await fsp.stat(join(mechaDir, entry));
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const config = readCasaConfig(join(mechaDir, entry));
    if (!config) continue;
    /* v8 ignore stop */

    const tags: string[] = [];
    const expose: string[] = [];
    /* v8 ignore start -- defensive Array.isArray checks for config shape */
    if (Array.isArray(config.tags)) {
      for (const t of config.tags) { if (typeof t === "string") tags.push(t); }
    }
    if (Array.isArray(config.expose)) {
      for (const e of config.expose) { if (typeof e === "string") expose.push(e); }
    }
    /* v8 ignore stop */

    if (opts.tag && !tags.includes(opts.tag)) continue;
    if (opts.capability && !expose.includes(opts.capability)) continue;

    results.push({ name: entry, tags, expose, state: "unknown" });
  }

  return results;
}

export async function handleMeshTool(
  opts: MeshOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<MeshResult> {
  const { mechaDir, casaName } = opts;

  switch (name) {
    case "mesh_query": {
      const target = args.target as string;
      const message = args.message as string;

      if (!target || !message) {
        return { content: [{ type: "text", text: "Missing required: target, message" }], isError: true };
      }

      // Read target config once for both ACL expose check and routing
      const config = readCasaConfig(join(mechaDir, target));
      if (!config) {
        return { content: [{ type: "text", text: `CASA not found: ${target}` }], isError: true };
      }

      const acl = createAclEngine({
        mechaDir,
        /* v8 ignore start -- getExpose: only target path tested; non-target requires multi-CASA setup */
        getExpose: (name) => {
          if (name === target) return (config.expose ?? []) as Capability[];
          const other = readCasaConfig(join(mechaDir, name));
          return (other?.expose ?? []) as Capability[];
        },
        /* v8 ignore stop */
      });
      const result = acl.check(casaName, target, "query" as Capability);

      if (!result.allowed) {
        const reason = result.reason === "not_exposed"
          ? `${target} does not expose "query"`
          : `No ACL grant: ${casaName} → ${target} (query)`;
        return { content: [{ type: "text", text: `Access denied: ${reason}` }], isError: true };
      }

      try {
        const text = await forwardQueryToCasa(config.port, config.token, message);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: (err as Error).message }],
          isError: true,
        };
      }
    }

    case "mesh_discover": {
      const tag = args.tag as string | undefined;
      const capability = args.capability as string | undefined;

      if (capability && !isCapability(capability)) {
        return { content: [{ type: "text", text: `Invalid capability: "${capability}"` }], isError: true };
      }

      const casas = await discoverCasas(mechaDir, casaName, { tag, capability });

      if (casas.length === 0) {
        return { content: [{ type: "text", text: "No matching CASAs found" }] };
      }

      const lines = casas.map((c) =>
        `${c.name}: tags=[${c.tags.join(", ")}] expose=[${c.expose.join(", ")}]`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown mesh tool: ${name}` }], isError: true };
  }
}
