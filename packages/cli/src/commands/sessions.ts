import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import {
  mechaSessionList,
  mechaSessionGet,
  mechaSessionDelete,
  mechaSessionInterrupt,
  mechaSessionRename,
  mechaSessionConfigUpdate,
  remoteSessionList,
  remoteSessionGet,
  remoteSessionMetaUpdate,
  remoteSessionDelete,
} from "@mecha/service";
import type { SessionListResult } from "@mecha/service";
import type { SessionSummary, ParsedSession, ParsedMessage } from "@mecha/core";
import { toUserMessage, toExitCode } from "@mecha/contracts";
import { withNodeOption } from "./shared-options.js";
import { resolveTarget } from "./resolve-target.js";

function formatDate(d: Date): string {
  return d.toLocaleString();
}

function summarizeContent(msg: ParsedMessage): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    switch (block.type) {
      case "text": parts.push(block.text); break;
      case "thinking": parts.push(`[thinking: ${block.thinking.slice(0, 80)}...]`); break;
      case "tool_use": parts.push(`[tool: ${block.name}]`); break;
      case "tool_result": parts.push("[tool_result]"); break;
    }
  }
  return parts.join("\n");
}

export function registerSessionsCommand(parent: Command, deps: CommandDeps): void {
  const sessions = parent
    .command("sessions")
    .description("Manage chat sessions for a Mecha");

  withNodeOption(
    sessions
      .command("list <id>")
      .description("List all sessions for a Mecha (works when stopped)"),
  ).action(async (id: string, opts: { node?: string }) => {
    const { dockerClient, formatter } = deps;
    try {
      let result: SessionListResult;
      if (opts.node) {
        const target = await resolveTarget(dockerClient, id, opts.node);
        result = await remoteSessionList(dockerClient, id, target);
      } else {
        result = await mechaSessionList(dockerClient, { id });
      }
      const { sessions: sessionList, meta } = result;
      formatter.table(
        sessionList.map((s: SessionSummary) => {
          const m = meta[s.id];
          return {
            ID: s.id.slice(0, 8),
            TITLE: m?.customTitle ?? s.title,
            SLUG: s.projectSlug,
            MESSAGES: String(s.messageCount),
            MODEL: s.model ?? "-",
            STARRED: m?.starred ? "*" : "",
            UPDATED: formatDate(s.updatedAt),
          };
        }),
        ["ID", "TITLE", "SLUG", "MESSAGES", "MODEL", "STARRED", "UPDATED"],
      );
    } catch (err) {
      formatter.error(toUserMessage(err));
      process.exitCode = toExitCode(err);
    }
  });

  withNodeOption(
    sessions
      .command("show <id> <sessionId>")
      .description("Show session details and messages")
      .option("--raw", "Show full JSON content blocks"),
  ).action(async (id: string, sessionId: string, opts: { raw?: boolean; node?: string }) => {
    const { dockerClient, formatter } = deps;
    try {
      let session: ParsedSession;
      if (opts.node) {
        const target = await resolveTarget(dockerClient, id, opts.node);
        session = await remoteSessionGet(dockerClient, id, sessionId, target);
      } else {
        session = await mechaSessionGet(dockerClient, { id, sessionId });
      }
      formatter.info(`Session: ${session.id}`);
      formatter.info(`Project: ${session.projectSlug}`);
      formatter.info(`Title: ${session.title}`);
      formatter.info(`Messages: ${session.messageCount}`);
      formatter.info(`Model: ${session.model ?? "(unknown)"}`);
      formatter.info(`Created: ${formatDate(session.createdAt)}`);
      formatter.info(`Updated: ${formatDate(session.updatedAt)}`);
      if (session.messages.length > 0) {
        formatter.info("---");
        for (const msg of session.messages) {
          if (opts.raw) {
            formatter.info(`[${msg.role}] ${JSON.stringify(msg.content)}`);
          } else {
            formatter.info(`[${msg.role}] ${summarizeContent(msg)}`);
          }
        }
      }
    } catch (err) {
      formatter.error(toUserMessage(err));
      process.exitCode = toExitCode(err);
    }
  });

  withNodeOption(
    sessions
      .command("delete <id> <sessionId>")
      .description("Delete a session"),
  ).action(async (id: string, sessionId: string, opts: { node?: string }) => {
    const { dockerClient, formatter } = deps;
    try {
      if (opts.node) {
        const target = await resolveTarget(dockerClient, id, opts.node);
        await remoteSessionDelete(dockerClient, id, sessionId, target);
      } else {
        await mechaSessionDelete(dockerClient, { id, sessionId });
      }
      formatter.success(`Session ${sessionId} deleted`);
    } catch (err) {
      formatter.error(toUserMessage(err));
      process.exitCode = toExitCode(err);
    }
  });

  sessions
    .command("interrupt <id> <sessionId>")
    .description("Interrupt an active session")
    .action(async (id: string, sessionId: string) => {
      const { dockerClient, formatter } = deps;
      try {
        const result = await mechaSessionInterrupt(dockerClient, { id, sessionId });
        if (result.interrupted) {
          formatter.success(`Session ${sessionId} interrupted`);
        } else {
          formatter.info(`Session ${sessionId} was not busy`);
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  withNodeOption(
    sessions
      .command("rename <id> <sessionId> <title>")
      .description("Rename a session"),
  ).action(async (id: string, sessionId: string, title: string, opts: { node?: string }) => {
    const { dockerClient, formatter } = deps;
    try {
      if (opts.node) {
        const target = await resolveTarget(dockerClient, id, opts.node);
        await remoteSessionMetaUpdate(id, sessionId, { customTitle: title }, target);
        formatter.success(`Session ${sessionId} renamed to "${title}"`);
      } else {
        const result = await mechaSessionRename(dockerClient, { id, sessionId, title });
        formatter.success(`Session ${sessionId} renamed to "${result.title}"`);
      }
    } catch (err) {
      formatter.error(toUserMessage(err));
      process.exitCode = toExitCode(err);
    }
  });

  withNodeOption(
    sessions
      .command("star <id> <sessionId>")
      .description("Toggle starred status for a session"),
  ).action(async (id: string, sessionId: string, opts: { node?: string }) => {
    const { dockerClient, formatter } = deps;
    try {
      const target = await resolveTarget(dockerClient, id, opts.node);
      // Fetch current session list to determine current star status
      const listResult = await remoteSessionList(dockerClient, id, target);
      const currentMeta = listResult.meta[sessionId];
      const isStarred = currentMeta?.starred === true;
      await remoteSessionMetaUpdate(id, sessionId, { starred: !isStarred }, target);
      formatter.success(isStarred
        ? `Session ${sessionId} unstarred`
        : `Session ${sessionId} starred`,
      );
    } catch (err) {
      formatter.error(toUserMessage(err));
      process.exitCode = toExitCode(err);
    }
  });

  // --- config subcommands ---
  const config = sessions
    .command("config")
    .description("View or update session configuration");

  config
    .command("show <id> <sessionId>")
    .description("Show session summary (model, message count)")
    .action(async (id: string, sessionId: string) => {
      const { dockerClient, formatter } = deps;
      try {
        const session: ParsedSession = await mechaSessionGet(dockerClient, { id, sessionId });
        formatter.info(`Session: ${session.id}`);
        formatter.info(`Model: ${session.model ?? "(default)"}`);
        formatter.info(`Messages: ${session.messageCount}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  config
    .command("set <id> <sessionId>")
    .description("Update session configuration")
    .option("--model <model>", "Model name")
    .option("--permission-mode <mode>", "Permission mode (default, plan, full-auto)")
    .option("--system-prompt <prompt>", "System prompt")
    .option("--max-turns <n>", "Maximum turns")
    .option("--max-budget <usd>", "Maximum budget in USD")
    .action(async (id: string, sessionId: string, opts: {
      model?: string;
      permissionMode?: string;
      systemPrompt?: string;
      maxTurns?: string;
      maxBudget?: string;
    }) => {
      const { dockerClient, formatter } = deps;
      try {
        const configPayload: Record<string, unknown> = {};
        if (opts.model !== undefined) configPayload.model = opts.model;
        if (opts.permissionMode !== undefined) {
          const validModes = ["default", "plan", "full-auto"];
          if (!validModes.includes(opts.permissionMode)) {
            formatter.error(`Invalid permission mode "${opts.permissionMode}". Must be one of: ${validModes.join(", ")}`);
            process.exitCode = 1;
            return;
          }
          configPayload.permissionMode = opts.permissionMode;
        }
        if (opts.systemPrompt !== undefined) configPayload.systemPrompt = opts.systemPrompt;
        if (opts.maxTurns !== undefined) {
          const n = Number(opts.maxTurns);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
            formatter.error(`Invalid max turns "${opts.maxTurns}". Must be a positive integer.`);
            process.exitCode = 1;
            return;
          }
          configPayload.maxTurns = n;
        }
        if (opts.maxBudget !== undefined) {
          const n = Number(opts.maxBudget);
          if (!Number.isFinite(n) || n <= 0) {
            formatter.error(`Invalid max budget "${opts.maxBudget}". Must be a positive number.`);
            process.exitCode = 1;
            return;
          }
          configPayload.maxBudgetUsd = n;
        }

        if (Object.keys(configPayload).length === 0) {
          formatter.error("No config options provided. Use --model, --permission-mode, --system-prompt, --max-turns, or --max-budget.");
          process.exitCode = 1;
          return;
        }

        await mechaSessionConfigUpdate(dockerClient, { id, sessionId, config: configPayload });
        formatter.success(`Session ${sessionId} config updated`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
