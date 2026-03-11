/* v8 ignore start -- SDK boundary: spawns external claude process, tested via integration */
/**
 * Daemon-side SDK chat execution.
 *
 * The mecha binary is a Bun SEA. Child processes spawned by Bun SEA (bot runtimes)
 * cannot posix_spawn external binaries on macOS (EPERM). The daemon process (top-level)
 * CAN spawn, so SDK queries are executed here instead of in the bot runtime.
 */
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { createLogger, readBotConfig } from "@mecha/core";
import { readProxyInfo, isPidAlive, meterDir } from "@mecha/meter";

const log = createLogger("mecha:daemon-chat");

export interface DaemonChatResult {
  response: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

/**
 * Execute an SDK query in the daemon process context on behalf of a bot.
 * Uses the daemon's env (which has API keys, full PATH) + bot-specific overrides
 * (HOME for session storage, ANTHROPIC_BASE_URL for metering).
 */
export async function daemonChat(
  mechaDir: string,
  botName: string,
  message: string,
  sessionId?: string,
): Promise<DaemonChatResult> {
  const botDir = join(mechaDir, botName);
  const config = readBotConfig(botDir);
  if (!config) {
    throw new Error(`Bot config not found for "${botName}"`);
  }

  const homeDir = config.home ?? botDir;

  // Start with daemon's full env, then override bot-specific vars.
  // The daemon's env has API keys (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN),
  // a full PATH (including node, claude), and standard system vars.
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: homeDir,
    CLAUDECODE: "0", // bypass nested session guard (checks === "1")
  };

  // Meter proxy integration — route API calls through the meter for usage tracking
  const md = meterDir(mechaDir);
  const proxyInfo = readProxyInfo(md);
  if (proxyInfo && isPidAlive(proxyInfo.pid)) {
    env["ANTHROPIC_BASE_URL"] = `http://127.0.0.1:${proxyInfo.port}/bot/${botName}`;
  }

  // System prompt configuration from bot config
  const sysPrompt = config.systemPrompt
    ? config.systemPrompt
    : config.appendSystemPrompt
      ? { type: "preset" as const, preset: "claude_code" as const, append: config.appendSystemPrompt }
      : undefined;

  let result: SDKResultMessage | undefined;

  for await (const event of query({
    prompt: message,
    options: {
      cwd: config.workspace,
      resume: sessionId,
      pathToClaudeCodeExecutable: "claude",
      settingSources: ["project"],
      maxTurns: 25,
      env,
      ...(sysPrompt != null && { systemPrompt: sysPrompt }),
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

  const errorMsg = result.errors?.length ? result.errors.join("; ") : "SDK query failed";
  log.error("Daemon chat error", { botName, errors: result.errors });
  throw new Error(errorMsg);
}
/* v8 ignore stop */
