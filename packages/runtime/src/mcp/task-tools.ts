/**
 * MCP tools for bot-to-bot task delegation.
 * Bots use these to create, monitor, cancel, and list tasks via the agent server.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { readTotpSecret } from "@mecha/core";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool definitions for task protocol operations. */
export const TASK_TOOLS: McpToolDef[] = [
  {
    name: "task_create",
    description: "Create a task for another bot to execute. Returns the task ID.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Bot name to run the task" },
        message: { type: "string", description: "Task message/instruction" },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "task_status",
    description: "Check the status and result of a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to check" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_cancel",
    description: "Cancel a running task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to cancel" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_list",
    description: "List tasks with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Filter by target bot name" },
        status: { type: "string", description: "Filter by status (pending, working, completed, failed, cancelled)" },
      },
    },
  },
];

/** Runtime context for task tool execution. */
export interface TaskToolOpts {
  mechaDir: string;
  botName: string;
}

interface TaskResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Resolve agent server URL and auth from mechaDir/agent.json. */
function resolveAgent(mechaDir: string): { url: string; auth: string } | undefined {
  const agentPath = join(mechaDir, "agent.json");
  /* v8 ignore start -- agent.json requires running agent server */
  if (!existsSync(agentPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(agentPath, "utf-8")) as { port?: number; host?: string };
    if (typeof data.port !== "number") return undefined;
    const rawHost = data.host ?? "127.0.0.1";
    const hostPart = rawHost === "0.0.0.0" ? "127.0.0.1"
      : rawHost === "::" ? "[::1]"
      : rawHost.includes(":") ? `[${rawHost}]`
      : rawHost;

    // Derive auth from TOTP secret (same as CLI agent-auth)
    const secret = readTotpSecret(mechaDir);
    if (!secret) return undefined;
    const auth = createHmac("sha256", secret).update("mecha-mesh-routing").digest("hex");

    return { url: `http://${hostPart}:${data.port}`, auth };
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** Dispatch a task tool call and return the MCP result. */
export async function handleTaskTool(
  opts: TaskToolOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<TaskResult> {
  const agent = resolveAgent(opts.mechaDir);
  if (!agent) {
    return { content: [{ type: "text", text: "Agent server not running or TOTP secret missing" }], isError: true };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${agent.auth}`,
    "x-mecha-source": `${opts.botName}@local`,
  };

  try {
    switch (name) {
      case "task_create": {
        const target = args.target;
        const message = args.message;
        if (typeof target !== "string" || !target) {
          return { content: [{ type: "text", text: "Missing required: target (string)" }], isError: true };
        }
        if (typeof message !== "string" || !message) {
          return { content: [{ type: "text", text: "Missing required: message (string)" }], isError: true };
        }
        const res = await fetch(`${agent.url}/tasks`, {
          method: "POST",
          headers,
          body: JSON.stringify({ target, message }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Failed: ${body.error ?? res.statusText}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Task created: ${body.id} (status: ${body.status})` }] };
      }

      case "task_status": {
        const taskId = args.taskId;
        if (typeof taskId !== "string" || !taskId) {
          return { content: [{ type: "text", text: "Missing required: taskId (string)" }], isError: true };
        }
        const res = await fetch(`${agent.url}/tasks/${encodeURIComponent(taskId)}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          const body = await res.json() as Record<string, unknown>;
          return { content: [{ type: "text", text: `Failed: ${body.error ?? res.statusText}` }], isError: true };
        }
        const task = await res.json() as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
      }

      case "task_cancel": {
        const taskId = args.taskId;
        if (typeof taskId !== "string" || !taskId) {
          return { content: [{ type: "text", text: "Missing required: taskId (string)" }], isError: true };
        }
        const res = await fetch(`${agent.url}/tasks/${encodeURIComponent(taskId)}/cancel`, {
          method: "POST",
          headers,
          body: "{}",
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          const body = await res.json() as Record<string, unknown>;
          return { content: [{ type: "text", text: `Failed: ${body.error ?? res.statusText}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Task ${taskId} cancelled` }] };
      }

      case "task_list": {
        const params = new URLSearchParams();
        if (typeof args.target === "string" && args.target) params.set("target", args.target);
        if (typeof args.status === "string" && args.status) params.set("status", args.status);
        const qs = params.toString();
        const res = await fetch(`${agent.url}/tasks${qs ? `?${qs}` : ""}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          const body = await res.json() as Record<string, unknown>;
          return { content: [{ type: "text", text: `Failed: ${body.error ?? res.statusText}` }], isError: true };
        }
        const tasks = await res.json() as unknown[];
        if (tasks.length === 0) {
          return { content: [{ type: "text", text: "No tasks found" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown task tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Task tool error: ${msg}` }], isError: true };
  }
}
