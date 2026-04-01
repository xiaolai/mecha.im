import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskResponse } from "../types";

const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000") || 600000;
// Codex MCP auto-detection:
// 1. Subscription credentials mounted (~/.codex/auth.json exists), or
// 2. API key user with CODEX_API_KEY set in env
// CODEX_MCP=true forces enablement but still requires auth to be present.
import { existsSync } from "node:fs";
const CODEX_CRED_PATH = `${process.env.HOME || "/home/worker"}/.codex/auth.json`;
const CODEX_HAS_CREDS = existsSync(CODEX_CRED_PATH);
const CODEX_HAS_KEY = !!process.env.CODEX_API_KEY;
const CODEX_MCP_REQUESTED = process.env.CODEX_MCP === "true" || CODEX_HAS_CREDS || CODEX_HAS_KEY;
const CODEX_MCP_TOOLS = ["mcp__codex__codex", "mcp__codex__codex-reply", "mcp__codex__websearch"];

// Fail fast: if CODEX_MCP=true but no auth is available, error at startup
if (process.env.CODEX_MCP === "true" && !CODEX_HAS_CREDS && !CODEX_HAS_KEY) {
  console.error("CODEX_MCP=true but no auth found: need ~/.codex/auth.json (credentials mount) or CODEX_API_KEY");
  process.exit(1);
}

const CODEX_MCP_ENABLED = CODEX_MCP_REQUESTED && (CODEX_HAS_CREDS || CODEX_HAS_KEY);

if (CODEX_MCP_ENABLED) {
  const method = CODEX_HAS_CREDS ? "subscription credentials" : "API key";
  console.log(`codex MCP enabled via ${method} — codex mcp-server will be spawned as child process`);
}

/** Execute a task using the Claude Agent SDK. Optionally wires Codex as an MCP child process. */
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

    // Only auto-add Codex tools when no explicit CLAUDE_ALLOWED_TOOLS was set.
    // If the operator specified an allowlist, they control what tools are available.
    if (!process.env.CLAUDE_ALLOWED_TOOLS) {
      options.allowedTools = [...CODEX_MCP_TOOLS];
    }
    // Respect CLAUDE_DISALLOWED_TOOLS as a hard veto — never override it.
    // Operators who want Codex tools but not websearch can disallow it.
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

/** Sum a token field across all model usage entries (multi-turn may have multiple). */
function sumTokens(usage: Record<string, any> | undefined, field: string): number {
  if (!usage) return 0;
  return Object.values(usage).reduce((sum: number, m: any) => sum + (m[field] || 0), 0);
}
