/* v8 ignore start -- SDK boundary: spawns external claude process, tested via integration */
/**
 * SDK-backed chat implementation.
 * Wraps `query()` from @anthropic-ai/claude-agent-sdk to provide:
 * - POST /api/chat handler (enables inter-bot routing, MCP mecha_query)
 * - ChatFn for the schedule engine
 */
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@mecha/core";
import type { ActivityEmitter } from "./activity.js";
import { emitActivityFromEvent } from "./sdk-chat-activity.js";
import type { ChatFn } from "./scheduler.js";

const log = createLogger("mecha:sdk-chat");

/**
 * Override CLAUDECODE env var so the SDK child process doesn't hit the nested-session guard.
 * The SDK always prepends CLAUDECODE:"1" to the spawn env; we override it with "0"
 * so the guard check (`=== "1"`) evaluates to false.
 */
function stripNestedGuard(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...env, CLAUDECODE: "0" };
}

/**
 * Resolve the Node.js executable path.
 * Needed because Bun SEA binaries cannot reliably posix_spawn system binaries
 * from child processes (macOS EPERM bug). Running cli.js under Node avoids this.
 */
function resolveNodePath(): string | undefined {
  if (process.env["MECHA_NODE_PATH"]) {
    return process.env["MECHA_NODE_PATH"];
  }
  try {
    const resolved = execFileSync("which", ["node"], { encoding: "utf-8" }).trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the cli.js path from the claude-agent-sdk or claude-code package.
 * Tries MECHA_CLAUDE_CLI_JS env, then looks relative to the claude binary,
 * then searches common npm global locations.
 */
function resolveCliJsPath(claudeBinaryPath?: string): string | undefined {
  // Explicit override
  if (process.env["MECHA_CLAUDE_CLI_JS"]) {
    return process.env["MECHA_CLAUDE_CLI_JS"];
  }

  // Check near the claude binary (npm global install puts them together)
  if (claudeBinaryPath) {
    try {
      const realPath = realpathSync(claudeBinaryPath);
      // Native binary is at <prefix>/versions/<ver>, cli.js may be at <prefix>/../lib/node_modules/...
      const binDir = dirname(realPath);
      // Check sibling cli.js
      const siblingCliJs = join(binDir, "cli.js");
      if (existsSync(siblingCliJs)) return siblingCliJs;
    } catch { /* ignore */ }
  }

  // Search for globally installed cli.js
  const searchPaths = [
    // nvm-based installs
    ...(process.env["NVM_DIR"]
      ? [`${process.env["NVM_DIR"]}/versions/node`]
      : [`${process.env["HOME"] ?? "/Users"}/.nvm/versions/node`]),
    // System node_modules
    "/usr/local/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
  ];

  const sdkPackages = [
    "@anthropic-ai/claude-agent-sdk/cli.js",
    "@anthropic-ai/claude-code/cli.js",
  ];

  for (const base of searchPaths) {
    // For nvm paths, search the latest version directory
    if (base.includes("nvm")) {
      try {
        const versions = execFileSync("ls", ["-1", base], { encoding: "utf-8" }).trim().split("\n");
        for (const ver of versions.reverse()) {
          for (const pkg of sdkPackages) {
            const candidate = join(base, ver, "lib/node_modules", pkg);
            if (existsSync(candidate)) return candidate;
          }
        }
      } catch { /* ignore */ }
    } else {
      for (const pkg of sdkPackages) {
        const candidate = join(base, pkg);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Resolve the path to the `claude` CLI binary (native Bun SEA).
 * Used as fallback when Node.js + cli.js is not available.
 */
function resolveClaudeBinaryPath(): string | undefined {
  if (process.env["MECHA_CLAUDE_PATH"]) {
    return process.env["MECHA_CLAUDE_PATH"];
  }
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Cached resolution results — avoids import-time side effects. */
let resolved: { nodePath?: string; cliJsPath?: string; claudeBinary?: string; useNode: boolean } | null = null;

function resolveExecPaths(): typeof resolved & {} {
  if (resolved) return resolved;

  const claudeBinary = resolveClaudeBinaryPath();
  const nodePath = resolveNodePath();
  const cliJsPath = nodePath ? resolveCliJsPath(claudeBinary) : undefined;
  const useNode = !!(nodePath && cliJsPath);

  resolved = { nodePath, cliJsPath, claudeBinary, useNode };

  if (useNode) {
    log.info("Using Node.js + cli.js for SDK queries", { node: nodePath, cliJs: cliJsPath });
  } else if (claudeBinary) {
    log.info("Using native claude binary for SDK queries", { path: claudeBinary });
  } else {
    log.warn("claude CLI not found — install with: npm install -g @anthropic-ai/claude-code");
  }

  return resolved;
}

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

    const queryEnv = stripNestedGuard({ ...process.env, ...opts.env });
    const paths = resolveExecPaths();

    for await (const event of query({
      prompt: message,
      options: {
        cwd: opts.workspacePath,
        resume: sessionId,
        pathToClaudeCodeExecutable: paths.useNode ? paths.cliJsPath! : (paths.claudeBinary ?? "claude"),
        ...(paths.useNode && { executable: "node" as const, executableArgs: [] }),
        settingSources: [...(opts.settingSources ?? ["project"])],
        maxTurns: 25,
        env: queryEnv,
        abortController: ac,
        ...(sysPrompt != null && { systemPrompt: sysPrompt }),
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
