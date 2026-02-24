import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

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

function listFiles(workspacePath: string, subpath: string): string[] {
  const target = subpath ? join(workspacePath, subpath) : workspacePath;
  const resolved = join(workspacePath, subpath || ".");

  // Prevent path traversal
  if (!resolved.startsWith(workspacePath)) {
    throw new Error("Path traversal not allowed");
  }

  try {
    const entries = readdirSync(target, { withFileTypes: true });
    return entries.map((e) => {
      const rel = relative(workspacePath, join(target, e.name));
      return e.isDirectory() ? `${rel}/` : rel;
    });
  } catch {
    throw new Error(`Directory not found: ${subpath || "/"}`);
  }
}

function readFile(workspacePath: string, filePath: string): string {
  const resolved = join(workspacePath, filePath);

  // Prevent path traversal
  if (!resolved.startsWith(workspacePath)) {
    throw new Error("Path traversal not allowed");
  }

  try {
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
    return readFileSync(resolved, "utf-8");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path is a directory")) {
      throw err;
    }
    throw new Error(`File not found: ${filePath}`);
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

function handleRequest(workspacePath: string, req: JsonRpcRequest): JsonRpcResponse {
  const id = req.id ?? null;

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
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

    case "tools/call": {
      const params = req.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      try {
        const result = handleToolCall(workspacePath, name, args);
        return { jsonrpc: "2.0", id, result };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: (err as Error).message }],
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
}

export function registerMcpRoutes(app: FastifyInstance, opts: McpRouteOpts): void {
  app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as JsonRpcRequest;
    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
      return;
    }
    const response = handleRequest(opts.workspacePath, body);
    return response;
  });
}
