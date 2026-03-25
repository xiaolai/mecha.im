/* v8 ignore start -- SDK boundary: spawns external claude process, tested via integration */
/**
 * SDK-backed chat implementation.
 * Wraps `query()` from @anthropic-ai/claude-agent-sdk to provide:
 * - POST /api/chat handler (enables inter-bot routing, MCP mecha_query)
 * - ChatFn for the schedule engine
 */
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createLogger } from "@mecha/core";
import type { ActivityEmitter } from "./activity.js";
import { emitActivityFromEvent } from "./sdk-chat-activity.js";
import type { ChatFn } from "./scheduler.js";

const log = createLogger("mecha:sdk-chat");

/**
 * Resolve the path to the `claude` CLI.
 * Returns the original path (not symlink-resolved) — the OS handles shebang
 * execution. Resolving symlinks breaks sandboxed bots where the symlink target
 * may be outside the sandbox read paths.
 */
function resolveClaudePath(): string | undefined {
  if (process.env["MECHA_CLAUDE_PATH"]) {
    return process.env["MECHA_CLAUDE_PATH"];
  }
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Lazily resolved claude CLI path — avoids import-time side effects. */
let claudePath: string | undefined | null = null; // null = not yet resolved

function getClaudePath(): string | undefined {
  if (claudePath === null) {
    claudePath = resolveClaudePath();
    if (claudePath) {
      log.info("Resolved claude CLI", { path: claudePath });
    } else {
      log.warn("claude CLI not found — install with: npm install -g @anthropic-ai/claude-code");
    }
  }
  return claudePath ?? undefined;
}

/** Options for SDK-backed chat execution. */
export interface SdkChatOpts {
  /** Bot's workspace directory — passed as cwd to query(). */
  workspacePath: string;
  /** Load project-level CLAUDE.md, rules, skills, hooks. */
  settingSources?: readonly ("project" | "user" | "local")[];
  /** Environment variables for the spawned claude process. */
  env?: Record<string, string | undefined>;
  /** Full system prompt override (mutually exclusive with appendSystemPrompt). */
  systemPrompt?: string;
  /** Append to default system prompt (mutually exclusive with systemPrompt). */
  appendSystemPrompt?: string;
  /** Optional activity emitter for real-time visualization. */
  activityEmitter?: ActivityEmitter;
  /** Bot name used as the activity event source. */
  botName?: string;
  /** MCP servers to connect to. */
  mcpServers?: Record<string, unknown>;
  /** Permission mode for tool use (e.g., "auto" to skip interactive prompts). */
  permissionMode?: string;
}

interface ChatResult {
  response: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

/**
 * Execute a single SDK query and return the result.
 * Used by both the /api/chat route handler and the schedule chatFn.
 */
export async function sdkChat(
  opts: SdkChatOpts,
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  let result: SDKResultMessage | undefined;
  const queryId = randomUUID();

  // Bridge external AbortSignal to SDK's abortController
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) {
      ac.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let queryEnded = false;

  try {
    // systemPrompt and appendSystemPrompt are mutually exclusive — prefer systemPrompt if both set.
    if (opts.systemPrompt && opts.appendSystemPrompt) {
      log.warn("Both systemPrompt and appendSystemPrompt set — using systemPrompt (full override)");
    }

    // Build systemPrompt option for SDK query (R6-004).
    // SDK accepts string (full override) or { type: "preset", preset: "claude_code", append: "..." }.
    const sysPrompt = opts.systemPrompt
      ? opts.systemPrompt
      : opts.appendSystemPrompt
        ? { type: "preset" as const, preset: "claude_code" as const, append: opts.appendSystemPrompt }
        : undefined;

    for await (const event of query({
      prompt: message,
      options: {
        cwd: opts.workspacePath,
        resume: sessionId,
        pathToClaudeCodeExecutable: getClaudePath(),
        settingSources: [...(opts.settingSources ?? ["project", "user"])],
        maxTurns: 25,
        env: opts.env,
        abortController: ac,
        stderr: (data: string) => { log.debug("claude stderr", { data: data.trim() }); },
        ...(sysPrompt != null && { systemPrompt: sysPrompt }),
        ...(opts.mcpServers != null && Object.keys(opts.mcpServers).length > 0 && {
          mcpServers: opts.mcpServers as Record<string, never>,
        }),
        // Bots are non-interactive (headless) — auto-approve all tool use.
        // permissionMode in bot config is for future fine-grained filtering;
        // the SDK callback model handles permissions directly, so we always
        // allow here. Security boundary is the sandbox, not tool approval.
        canUseTool: async () => ({ behavior: "allow" as const }),
      },
    })) {
      if (opts.activityEmitter && opts.botName) {
        emitActivityFromEvent(opts.activityEmitter, { name: opts.botName, queryId }, event as Record<string, unknown>);
      }
      if (event.type === "result") {
        result = event;
      }
    }

    queryEnded = true;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Emit idle for abort/throw paths — skip if query ended normally (result handler already emitted)
    if (!queryEnded && opts.activityEmitter && opts.botName) {
      opts.activityEmitter.emit({
        type: "activity", name: opts.botName, activity: "idle",
        queryId, timestamp: new Date().toISOString(),
      });
    }
  }

  if (!result) {
    throw new Error("SDK query returned no result");
  }

  if (result.subtype === "success") {
    return {
      response: result.result,
      sessionId: result.session_id,
      durationMs: result.duration_ms,
      costUsd: result.total_cost_usd,
    };
  }

  // Error result
  const errorMsg = result.errors?.length ? result.errors.join("; ") : "SDK query failed";
  log.error("SDK chat error", { sessionId, errors: result.errors });
  throw new Error(errorMsg);
}

/** Create a ChatFn compatible with the schedule engine. */
export function createChatFn(opts: SdkChatOpts): ChatFn {
  return async (prompt: string, signal?: AbortSignal) => {
    const start = Date.now();
    try {
      const result = await sdkChat(opts, prompt, undefined, signal);
      return { durationMs: result.durationMs };
    } catch (err) {
      return {
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
/* v8 ignore stop */
