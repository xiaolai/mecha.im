import { readdir, readFile as fsReadFile, stat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MESH_TOOLS, handleMeshTool, type MeshOpts, type MeshRouter } from "./mesh-tools.js";
import { BUS_TOOLS, handleBusTool, type BusToolOpts } from "./bus-tools.js";
import { WORKFLOW_TOOLS, handleWorkflowTool, type WorkflowToolOpts } from "./workflow-tools.js";
import { TASK_TOOLS, handleTaskTool, type TaskToolOpts } from "./task-tools.js";

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

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
    description: "List files in the bot workspace directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace (default: root)" },
      },
    },
  },
  {
    name: "mecha_workspace_read",
    description: "Read file content from the bot workspace",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to file within workspace" },
      },
      required: ["path"],
    },
  },
];

/**
 * Resolve a path inside the workspace boundary, following symlinks.
 * Returns the canonical (real) path. Throws on traversal or missing paths.
 */
async function resolveInsideWorkspace(resolved: string, workspacePath: string): Promise<string> {
  let realWorkspace: string;
  try {
    realWorkspace = await realpath(workspacePath);
  } catch {
    throw new Error("Workspace path is invalid");
  }
  let real: string;
  try {
    real = await realpath(resolved);
  /* v8 ignore start -- resolved path doesn't exist on disk */
  } catch {
    throw new Error("File not found");
  }
  /* v8 ignore stop */
  const rel = relative(realWorkspace, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path traversal not allowed");
  }
  return real;
}

async function listFiles(workspacePath: string, subpath: string): Promise<string[]> {
  const target = subpath ? join(workspacePath, subpath) : workspacePath;
  const canonicalTarget = await resolveInsideWorkspace(target, workspacePath);

  try {
    const entries = await readdir(canonicalTarget, { withFileTypes: true });
    return entries.map((e) => {
      const rel = relative(workspacePath, join(target, e.name));
      return e.isDirectory() ? `${rel}/` : rel;
    });
  /* v8 ignore start -- directory vanished between resolveInsideWorkspace and readdir */
  } catch {
    throw new Error(`Directory not found: ${subpath || "/"}`);
  }
  /* v8 ignore stop */
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function readFileContent(workspacePath: string, filePath: string): Promise<string> {
  const resolved = join(workspacePath, filePath);
  const canonicalPath = await resolveInsideWorkspace(resolved, workspacePath);

  try {
    const fileStat = await stat(canonicalPath);
    if (fileStat.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${filePath} (${fileStat.size} bytes, max ${MAX_FILE_SIZE})`);
    }
    const content = await fsReadFile(canonicalPath, "utf-8");
    // Re-validate after read to mitigate TOCTOU symlink swap
    const postReadReal = await realpath(resolved).catch(() => null);
    if (!postReadReal || postReadReal !== canonicalPath) {
      throw new Error("Path traversal not allowed");
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path is a directory")) {
      throw err;
    }
    if (err instanceof Error && err.message.startsWith("Path traversal")) {
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

async function handleToolCall(
  workspacePath: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case "mecha_workspace_list": {
      if (args.path !== undefined && typeof args.path !== "string") {
        throw new Error("Missing required argument: path must be a string");
      }
      const files = await listFiles(workspacePath, typeof args.path === "string" ? args.path : "");
      return { content: [{ type: "text", text: files.join("\n") }] };
    }
    case "mecha_workspace_read": {
      if (typeof args.path !== "string" || !args.path) {
        throw new Error("Missing required argument: path");
      }
      const text = await readFileContent(workspacePath, args.path);
      return { content: [{ type: "text", text }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Prefixes of error messages safe to expose to clients (no filesystem details). */
const SAFE_ERROR_PREFIXES: ReadonlyArray<string> = [
  "Path traversal not allowed",
  "Workspace path is invalid",
  "Path is a directory",
  "File too large",
  "Missing required argument",
  "Unknown tool",
  "Directory not found",
  "File not found",
  "Access denied",
  "bot not found",
];

/* v8 ignore start -- .some() short-circuit creates untestable per-element branches */
function isSafeErrorMessage(msg: string): boolean {
  return SAFE_ERROR_PREFIXES.some((prefix) => msg.startsWith(prefix));
}
/* v8 ignore stop */

const ToolCallParams = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).default({}),
});

const MESH_TOOL_NAMES = new Set(MESH_TOOLS.map((t) => t.name));
const BUS_TOOL_NAMES = new Set(BUS_TOOLS.map((t) => t.name));
const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOLS.map((t) => t.name));
const TASK_TOOL_NAMES = new Set(TASK_TOOLS.map((t) => t.name));

function isMeshTool(name: string): boolean {
  return MESH_TOOL_NAMES.has(name);
}

function isBusTool(name: string): boolean {
  return BUS_TOOL_NAMES.has(name);
}

function isWorkflowTool(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has(name);
}

function isTaskTool(name: string): boolean {
  return TASK_TOOL_NAMES.has(name);
}

/** Grouped optional tool contexts for handleRequest. */
interface ToolContexts {
  meshOpts?: MeshOpts;
  busOpts?: BusToolOpts;
  workflowOpts?: WorkflowToolOpts;
  taskOpts?: TaskToolOpts;
}

async function handleRequest(
  workspacePath: string,
  ctx: ToolContexts,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const allTools = [
    ...TOOLS,
    ...(ctx.meshOpts ? MESH_TOOLS : []),
    ...(ctx.busOpts ? BUS_TOOLS : []),
    ...(ctx.workflowOpts ? WORKFLOW_TOOLS : []),
    ...(ctx.taskOpts ? TASK_TOOLS : []),
  ];

  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mecha-bot", version: pkg.version },
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: allTools } };

    case "tools/call": {
      const parseResult = ToolCallParams.safeParse(req.params ?? {});
      if (!parseResult.success) {
        return { jsonrpc: "2.0" as const, id, error: { code: -32602, message: "Invalid tool call params: name (string) is required" } };
      }
      const { name, arguments: args } = parseResult.data;
      try {
        // Mesh tools handled via mesh router
        if (isMeshTool(name) && ctx.meshOpts) {
          const result = await handleMeshTool(ctx.meshOpts, name, args);
          return { jsonrpc: "2.0", id, result };
        }
        // Bus tools handled via broker
        if (isBusTool(name) && ctx.busOpts) {
          const result = await handleBusTool(ctx.busOpts, name, args);
          return { jsonrpc: "2.0", id, result };
        }
        // Workflow tools handled via engine
        if (isWorkflowTool(name) && ctx.workflowOpts) {
          const result = await handleWorkflowTool(ctx.workflowOpts, name, args);
          return { jsonrpc: "2.0", id, result };
        }
        // Task tools handled via agent server
        if (isTaskTool(name) && ctx.taskOpts) {
          const result = await handleTaskTool(ctx.taskOpts, name, args);
          return { jsonrpc: "2.0", id, result };
        }
        const result = await handleToolCall(workspacePath, name, args);
        return { jsonrpc: "2.0", id, result };
      } catch (err) {
        const msg = (err as Error).message;
        // Only expose safe error messages; hide filesystem details
        /* v8 ignore start -- false branch: unexpected internal errors sanitized to generic message */
        const safeMsg = isSafeErrorMessage(msg) ? msg : "Tool execution failed";
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

/** Options for MCP route registration (workspace tools + optional mesh tools). */
export interface McpRouteOpts {
  workspacePath: string;
  mechaDir?: string;
  botName?: string;
  router?: MeshRouter;
  /** Agent daemon port for proxy routing when no direct router (default: 7660). */
  agentPort?: number;
  /** Agent daemon API key for proxy authentication. */
  agentApiKey?: string;
}

/** Register POST /mcp JSON-RPC endpoint for workspace, mesh, bus, and workflow tool calls. */
export function registerMcpRoutes(app: FastifyInstance, opts: McpRouteOpts): void {
  const meshOpts: MeshOpts | undefined =
    opts.mechaDir && opts.botName
      ? { mechaDir: opts.mechaDir, botName: opts.botName, router: opts.router, agentPort: opts.agentPort, agentApiKey: opts.agentApiKey }
      : undefined;

  const busOpts: BusToolOpts | undefined =
    opts.mechaDir && opts.botName
      ? { busDir: join(opts.mechaDir, "bus"), botName: opts.botName }
      : undefined;

  const workflowOpts: WorkflowToolOpts | undefined =
    opts.mechaDir
      ? { workflowsDir: join(opts.mechaDir, "workflows") }
      : undefined;

  const taskOpts: TaskToolOpts | undefined =
    opts.mechaDir && opts.botName
      ? { mechaDir: opts.mechaDir, botName: opts.botName }
      : undefined;

  const ctx: ToolContexts = { meshOpts, busOpts, workflowOpts, taskOpts };

  app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = JsonRpcRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
      return;
    }
    const response = await handleRequest(opts.workspacePath, ctx, parseResult.data);
    return response;
  });
}
