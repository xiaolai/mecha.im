/* v8 ignore start -- SDK boundary: spawns external claude process, tested via integration */
/**
 * SDK-backed chat implementation.
 * Wraps `query()` from @anthropic-ai/claude-agent-sdk to provide:
 * - POST /api/chat handler (enables inter-bot routing, MCP mecha_query)
 * - ChatFn for the schedule engine
 */
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@mecha/core";
import type { ChatFn } from "./scheduler.js";

const log = createLogger("mecha:sdk-chat");

export interface SdkChatOpts {
  /** Bot's workspace directory — passed as cwd to query(). */
  workspacePath: string;
  /** Load project-level CLAUDE.md, rules, skills, hooks. */
  settingSources?: readonly ("project" | "user" | "local")[];
  /** Environment variables for the spawned claude process. */
  env?: Record<string, string | undefined>;
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

  // Bridge external AbortSignal to SDK's abortController
  const ac = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  for await (const event of query({
    prompt: message,
    options: {
      cwd: opts.workspacePath,
      resume: sessionId,
      settingSources: [...(opts.settingSources ?? ["project"])],
      maxTurns: 25,
      env: opts.env,
      abortController: ac,
    },
  })) {
    if (event.type === "result") {
      result = event;
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
  const errorMsg = result.errors?.join("; ") ?? "SDK query failed";
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
