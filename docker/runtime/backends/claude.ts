import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskResponse } from "../types";

const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000"); // 10m

export async function executeTask(prompt: string): Promise<TaskResponse> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  const options: Record<string, unknown> = {
    cwd: "/workspace",
    persistSession: false,
    abortController,
  };

  if (process.env.CLAUDE_MODEL) options.model = process.env.CLAUDE_MODEL;
  if (process.env.CLAUDE_SYSTEM_PROMPT) options.systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
  if (process.env.CLAUDE_PERMISSION_MODE) options.permissionMode = process.env.CLAUDE_PERMISSION_MODE;
  if (process.env.CLAUDE_EFFORT) options.effort = process.env.CLAUDE_EFFORT;
  if (process.env.CLAUDE_MAX_BUDGET_USD) options.maxBudgetUsd = parseFloat(process.env.CLAUDE_MAX_BUDGET_USD);
  if (process.env.CLAUDE_MAX_TURNS) options.maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS);

  if (process.env.CLAUDE_ALLOWED_TOOLS) {
    options.allowedTools = process.env.CLAUDE_ALLOWED_TOOLS.split(",").map((s: string) => s.trim());
  }
  if (process.env.CLAUDE_DISALLOWED_TOOLS) {
    options.disallowedTools = process.env.CLAUDE_DISALLOWED_TOOLS.split(",").map((s: string) => s.trim());
  }

  try {
    const q = query({ prompt, options });
    let result: TaskResponse = { output: "" };

    for await (const message of q) {
      if (message.type === "result") {
        clearTimeout(timeout);
        if (message.subtype === "success") {
          result = {
            output: message.result || "",
            metadata: {
              model: process.env.CLAUDE_MODEL,
              duration_ms: message.duration_ms,
              input_tokens: sumTokens(message.modelUsage, "inputTokens"),
              output_tokens: sumTokens(message.modelUsage, "outputTokens"),
              exit_code: 0,
            },
          };
        } else {
          result = {
            output: (message as any).errors?.join("\n") || `error: ${message.subtype}`,
            metadata: {
              model: process.env.CLAUDE_MODEL,
              exit_code: 1,
            },
          };
        }
      }
    }

    return result;
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return {
        output: "task timed out",
        metadata: { model: process.env.CLAUDE_MODEL, exit_code: 1 },
      };
    }
    throw err;
  }
}

function sumTokens(usage: Record<string, any> | undefined, field: string): number {
  if (!usage) return 0;
  return Object.values(usage).reduce((sum: number, m: any) => sum + (m[field] || 0), 0);
}
