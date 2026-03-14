import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { BotConfig } from "./types.js";
import type { TaskSource } from "./session.js";
import type {
  QueryResult, SdkEvent, SdkSystemEvent, SdkAssistantEvent, SdkResultEvent,
} from "./server.types.js";
import type { PromptOverrides } from "./server-schema.js";

export function getWorkspaceContext(): { cwd: string; settingSources: Array<"user" | "project"> | ["user"] } {
  const configuredCwd = process.env.MECHA_WORKSPACE_CWD;
  const enableProjectSettings = process.env.MECHA_ENABLE_PROJECT_SETTINGS === "1";
  if (configuredCwd) {
    return {
      cwd: configuredCwd,
      settingSources: enableProjectSettings ? ["user", "project"] : ["user"],
    };
  }

  if (existsSync("/home/appuser/workspace")) {
    return {
      cwd: "/home/appuser/workspace",
      settingSources: ["user", "project"],
    };
  }

  return {
    cwd: "/state/home-workspace",
    settingSources: ["user"],
  };
}

export function buildClaudeOptions(
  config: BotConfig,
  resumeSessionId?: string,
  mcpServers?: Record<string, unknown>[],
  overrides?: PromptOverrides,
): Record<string, unknown> {
  const workspace = getWorkspaceContext();
  const options: Record<string, unknown> = {
    model: overrides?.model ?? config.model,
    cwd: workspace.cwd,
    maxTurns: overrides?.max_turns ?? config.max_turns ?? 25,
    env: { ...process.env },
    permissionMode: config.permission_mode,
    settingSources: [...workspace.settingSources],
  };

  if (config.permission_mode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }

  const systemPrompt = overrides?.system ?? config.system;
  if (systemPrompt) {
    options.systemPrompt = systemPrompt;
  }

  const budget = overrides?.max_budget_usd ?? config.max_budget_usd;
  if (budget) {
    options.maxBudgetUsd = budget;
  }

  if (overrides?.effort) {
    options.effort = overrides.effort;
  }

  const resumeId = overrides?.resume ?? resumeSessionId;
  if (resumeId) {
    options.resume = resumeId;
  }

  if (mcpServers?.length) {
    options.mcpServers = mcpServers;
  }

  return options;
}

export async function runClaude(
  message: string,
  config: BotConfig,
  resumeSessionId?: string,
  onEvent?: (event: { type: string; data: unknown }) => void,
  mcpServers?: Record<string, unknown>[],
  overrides?: PromptOverrides,
): Promise<QueryResult> {
  const options = buildClaudeOptions(config, resumeSessionId, mcpServers, overrides);
  const response = query({ prompt: message, options });

  let resultText = "";
  let costUsd = 0;
  let sessionId = "";
  let durationMs = 0;
  let success = false;

  for await (const rawEvent of response) {
    const event = rawEvent as SdkEvent;

    if (event.type === "system") {
      const sysEvent = event as SdkSystemEvent;
      if (sysEvent.subtype === "init" && sysEvent.session_id) {
        sessionId = sysEvent.session_id;
      }
    }

    if (event.type === "assistant") {
      const assistEvent = event as SdkAssistantEvent;
      if (assistEvent.message?.content) {
        for (const block of assistEvent.message.content) {
          if (block.type === "text" && block.text) {
            resultText += block.text;
            onEvent?.({ type: "text", data: { content: block.text } });
          }
          if (block.type === "tool_use") {
            onEvent?.({ type: "tool_use", data: { tool: block.name, input: block.input } });
          }
        }
      }
    }

    if (event.type === "result") {
      const resEvent = event as SdkResultEvent;
      costUsd = resEvent.total_cost_usd ?? 0;
      sessionId = resEvent.session_id ?? sessionId;
      durationMs = resEvent.duration_ms ?? 0;
      success = resEvent.subtype === "success";
      resultText = resEvent.result ?? resultText;
    }
  }

  return { text: resultText, costUsd, sessionId, durationMs, success };
}

export function hasInternalAuthHeader(value: string | undefined, secret: string | undefined): boolean {
  if (!secret || !value) return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function promptSourceForRequest(c: import("hono").Context, secret: string | undefined, header: string): TaskSource {
  return hasInternalAuthHeader(c.req.header(header), secret) ? "interbot" : "interactive";
}

export function activityStateForSource(source: TaskSource): "thinking" | "calling" | "scheduled" | "webhook" {
  if (source === "interbot") return "calling";
  if (source === "schedule") return "scheduled";
  if (source === "webhook") return "webhook";
  return "thinking";
}

export function formatToolContext(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Read": case "Edit": case "Write": return String(obj.file_path ?? "");
    case "Bash": return String(obj.command ?? "").slice(0, 80);
    case "Grep": case "Glob": return String(obj.pattern ?? "");
    case "WebSearch": return String(obj.query ?? "");
    default: return "";
  }
}
