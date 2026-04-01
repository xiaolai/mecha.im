import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskResponse } from "../types";

const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000") || 600000;
// Codex MCP is enabled when:
// 1. Subscription credentials are mounted (~/.codex/auth.json exists), or
// 2. Explicitly set via CODEX_MCP=true (for API key users who set CODEX_API_KEY in env)
import { existsSync } from "node:fs";
const CODEX_CRED_PATH = `${process.env.HOME || "/home/worker"}/.codex/auth.json`;
const CODEX_MCP_ENABLED = process.env.CODEX_MCP === "true" || existsSync(CODEX_CRED_PATH);
const CODEX_MCP_TOOLS = ["mcp__codex__codex", "mcp__codex__codex-reply", "mcp__codex__websearch"];

if (CODEX_MCP_ENABLED) {
  console.log("codex MCP enabled — codex mcp-server will be spawned as child process");
}

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
  if (process.env.CLAUDE_MAX_BUDGET_USD) {
    const budget = parseFloat(process.env.CLAUDE_MAX_BUDGET_USD);
    if (!isNaN(budget) && budget > 0) options.maxBudgetUsd = budget;
  }
  if (process.env.CLAUDE_MAX_TURNS) {
    const turns = parseInt(process.env.CLAUDE_MAX_TURNS);
    if (!isNaN(turns) && turns > 0) options.maxTurns = turns;
  }

  if (process.env.CLAUDE_ALLOWED_TOOLS) {
    options.allowedTools = process.env.CLAUDE_ALLOWED_TOOLS.split(",").map((s: string) => s.trim());
  }
  if (process.env.CLAUDE_DISALLOWED_TOOLS) {
    options.disallowedTools = process.env.CLAUDE_DISALLOWED_TOOLS.split(",").map((s: string) => s.trim());
  }

  // Wire Codex as an MCP server if enabled
  if (CODEX_MCP_ENABLED) {
    // Inherit HOME so Codex finds ~/.codex/auth.json (subscription credentials)
    // and PATH so it can locate the codex binary.
    const codexEnv: Record<string, string> = {
      HOME: process.env.HOME || "/home/worker",
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    };
    // API key users can still set CODEX_API_KEY directly
    if (process.env.CODEX_API_KEY) codexEnv.CODEX_API_KEY = process.env.CODEX_API_KEY;

    options.mcpServers = {
      codex: {
        command: "codex",
        args: ["mcp-server"],
        env: codexEnv,
      },
    };

    // Add Codex MCP tools to allowed tools
    const allowed = (options.allowedTools as string[]) || [];
    for (const tool of CODEX_MCP_TOOLS) {
      if (!allowed.includes(tool)) allowed.push(tool);
    }
    if (allowed.length > 0) options.allowedTools = allowed;
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
