import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskResponse } from "../types";

export async function executeTask(prompt: string): Promise<TaskResponse> {
  const options: Record<string, unknown> = {};

  if (process.env.CLAUDE_MODEL) options.model = process.env.CLAUDE_MODEL;
  if (process.env.CLAUDE_SYSTEM_PROMPT) options.systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
  if (process.env.CLAUDE_PERMISSION_MODE) options.permissionMode = process.env.CLAUDE_PERMISSION_MODE;
  if (process.env.CLAUDE_EFFORT) options.effort = process.env.CLAUDE_EFFORT;
  if (process.env.CLAUDE_MAX_BUDGET_USD) options.maxBudgetUsd = parseFloat(process.env.CLAUDE_MAX_BUDGET_USD);
  if (process.env.CLAUDE_MAX_TURNS) options.maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS);

  if (process.env.CLAUDE_ALLOWED_TOOLS) {
    options.allowedTools = process.env.CLAUDE_ALLOWED_TOOLS.split(",").map(s => s.trim());
  }
  if (process.env.CLAUDE_DISALLOWED_TOOLS) {
    options.disallowedTools = process.env.CLAUDE_DISALLOWED_TOOLS.split(",").map(s => s.trim());
  }

  options.cwd = "/workspace";
  options.persistSession = false;

  const q = query({ prompt, options });

  let result: TaskResponse = { output: "" };

  for await (const message of q) {
    if (message.type === "result") {
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
}

function sumTokens(usage: Record<string, any> | undefined, field: string): number {
  if (!usage) return 0;
  return Object.values(usage).reduce((sum: number, m: any) => sum + (m[field] || 0), 0);
}
