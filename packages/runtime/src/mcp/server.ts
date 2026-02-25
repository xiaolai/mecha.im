import { readdirSync, readFileSync, statSync, realpathSync, promises as fsp } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MESH_TOOLS, handleMeshTool, type MeshOpts, type MeshRouter } from "./mesh-tools.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpToolDef[] = [
  {
    name: "mecha_workspace_list",
    description: "List files in the CASA workspace directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace (default: root)" },
      },
    },
  },
  {
    name: "mecha_workspace_read",
    description: "Read file content from the CASA workspace",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to file within workspace" },
      },
      required: ["path"],
    },
  },
];

/** Check that a resolved path stays inside the workspace boundary, following symlinks. */
function assertInsideWorkspace(resolved: string, workspacePath: string): void {
  let realWorkspace: string;
  try {
    realWorkspace = realpathSync(workspacePath);
  } catch {
    throw new Error("Workspace path is invalid");
  }
  let real: string;
  try {
    real = realpathSync(resolved);
  /* v8 ignore start -- resolved path doesn't exist on disk */
  } catch {
    throw new Error("File not found");
  }
  /* v8 ignore stop */
  const rel = relative(realWorkspace, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path traversal not allowed");
  }
}

function listFiles(workspacePath: string, subpath: string): string[] {
  const target = subpath ? join(workspacePath, subpath) : workspacePath;

  assertInsideWorkspace(target, workspacePath);

  try {
    const entries = readdirSync(target, { withFileTypes: true });
    return entries.map((e) => {
      const rel = relative(workspacePath, join(target, e.name));
      return e.isDirectory() ? `${rel}/` : rel;
    });
  /* v8 ignore start -- directory vanished between assertInsideWorkspace and readdir */
  } catch {
    throw new Error(`Directory not found: ${subpath || "/"}`);
  }
  /* v8 ignore stop */
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function readFile(workspacePath: string, filePath: string): string {
  const resolved = join(workspacePath, filePath);

  assertInsideWorkspace(resolved, workspacePath);

  try {
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${filePath} (${stat.size} bytes, max ${MAX_FILE_SIZE})`);
    }
    return readFileSync(resolved, "utf-8");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path is a directory")) {
      throw err;
    }
    /* v8 ignore start -- re-throw known errors; generic fallback for race (file vanishes between check and read) */
    if (err instanceof Error && err.message.startsWith("File too large")) {
      throw err;
    }
    throw new Error(`File not found: ${filePath}`);
    /* v8 ignore stop */
  }
}

function handleToolCall(
  workspacePath: string,
  name: string,
  args: Record<string, unknown>,
): { content: Array<{ type: string; text: string }> } {
  switch (name) {
    case "mecha_workspace_list": {
      const files = listFiles(workspacePath, (args.path as string) ?? "");
      return { content: [{ type: "text", text: files.join("\n") }] };
    }
    case "mecha_workspace_read": {
      const text = readFile(workspacePath, args.path as string);
      return { content: [{ type: "text", text }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const MESH_TOOL_NAMES = new Set(MESH_TOOLS.map((t) => t.name));

function isMeshTool(name: string): boolean {
  return MESH_TOOL_NAMES.has(name);
}

async function handleRequest(
  workspacePath: string,
  meshOpts: MeshOpts | undefined,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const allTools = meshOpts ? [...TOOLS, ...MESH_TOOLS] : TOOLS;

  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mecha-casa", version: "0.2.0" },
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: allTools } };

    case "tools/call": {
      const params = req.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      try {
        // Mesh tools are async and handled separately
        if (isMeshTool(name) && meshOpts) {
          const result = await handleMeshTool(meshOpts, name, args);
          return { jsonrpc: "2.0", id, result };
        }
        const result = handleToolCall(workspacePath, name, args);
        return { jsonrpc: "2.0", id, result };
      } catch (err) {
        const msg = (err as Error).message;
        // Only expose safe error messages; hide filesystem details
        /* v8 ignore start -- ternary chain: each branch tested individually; v8 marks false-paths as null */
        const safeMsg = msg === "Path traversal not allowed" ? msg
          : msg === "Workspace path is invalid" ? msg
          : msg.startsWith("Path is a directory") ? msg
          : msg.startsWith("File too large") ? msg
          : msg.startsWith("Unknown tool") ? msg
          : msg.startsWith("Directory not found") ? msg
          : msg.startsWith("File not found") ? msg
          : msg.startsWith("Access denied") ? msg
          : msg.startsWith("CASA not found") ? msg
          : "Tool execution failed";
        /* v8 ignore stop */
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: safeMsg }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

export interface McpRouteOpts {
  workspacePath: string;
  mechaDir?: string;
  casaName?: string;
  router?: MeshRouter;
}

export function registerMcpRoutes(app: FastifyInstance, opts: McpRouteOpts): void {
  const meshOpts: MeshOpts | undefined =
    opts.mechaDir && opts.casaName
      ? { mechaDir: opts.mechaDir, casaName: opts.casaName, router: opts.router }
      : undefined;

  app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as JsonRpcRequest;
    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
      return;
    }
    const response = await handleRequest(opts.workspacePath, meshOpts, body);
    return response;
  });
}
