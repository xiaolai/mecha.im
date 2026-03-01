import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
} from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaSessionsCommand(parent: Command, deps: CommandDeps): void {
  const sessions = parent
    .command("sessions")
    .description("Manage CASA sessions");

  sessions
    .command("list")
    .alias("ls")
    .description("List sessions")
    .argument("<name>", "CASA name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const list = await casaSessionList(deps.processManager, casaName(name));
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
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .action(async (name: string, sessionId: string) => withErrorHandler(deps, async () => {
      const session = await casaSessionGet(deps.processManager, casaName(name), sessionId);
      if (!session) {
        deps.formatter.error("Session not found");
        process.exitCode = 1;
        return;
      }
      deps.formatter.json(session);
    }));
}
