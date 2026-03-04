import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import {
  botSessionList,
  botSessionGet,
} from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerBotSessionsCommand(parent: Command, deps: CommandDeps): void {
  const sessions = parent
    .command("sessions")
    .description("Manage bot sessions");

  sessions
    .command("list")
    .alias("ls")
    .description("List sessions")
    .argument("<name>", "bot name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const list = await botSessionList(deps.processManager, botName(name));
      if (list.length === 0) {
        deps.formatter.info("No sessions");
        return;
      }
      if (deps.formatter.isJson) {
        deps.formatter.json(list);
      } else {
        deps.formatter.table(
          ["Session ID", "Title", "Created", "Updated"],
          list.map((entry: unknown) => {
            const s = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
            return [
            String(s.id ?? "-"),
            String(s.title ?? "-"),
            String(s.createdAt ?? "-"),
            String(s.updatedAt ?? "-"),
            ];
          }),
        );
      }
    }));

  sessions
    .command("show")
    .description("Show session details")
    .argument("<name>", "bot name")
    .argument("<session-id>", "Session ID")
    .action(async (name: string, sessionId: string) => withErrorHandler(deps, async () => {
      const session = await botSessionGet(deps.processManager, botName(name), sessionId);
      if (!session) {
        deps.formatter.error("Session not found");
        process.exitCode = 1;
        return;
      }
      deps.formatter.json(session);
    }));
}
