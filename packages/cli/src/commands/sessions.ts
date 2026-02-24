import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
  casaSessionCreate,
  casaSessionDelete,
  casaSessionMessage,
  casaSessionInterrupt,
  casaSessionRename,
} from "@mecha/service";

export function registerSessionsCommand(program: Command, deps: CommandDeps): void {
  const sessions = program
    .command("sessions")
    .description("Manage CASA sessions");

  sessions
    .command("list")
    .description("List sessions")
    .argument("<name>", "CASA name")
    .action(async (name: string) => {
      const list = await casaSessionList(deps.processManager, casaName(name));
      deps.formatter.json(list);
    });

  sessions
    .command("show")
    .description("Show session details")
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .action(async (name: string, sessionId: string) => {
      const session = await casaSessionGet(deps.processManager, casaName(name), sessionId);
      if (!session) {
        deps.formatter.error("Session not found");
        process.exitCode = 1;
        return;
      }
      deps.formatter.json(session);
    });

  sessions
    .command("create")
    .description("Create a new session")
    .argument("<name>", "CASA name")
    .option("-t, --title <title>", "Session title")
    .action(async (name: string, opts: { title?: string }) => {
      const session = await casaSessionCreate(deps.processManager, casaName(name), {
        title: opts.title,
      });
      deps.formatter.json(session);
    });

  sessions
    .command("delete")
    .description("Delete a session")
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .action(async (name: string, sessionId: string) => {
      const deleted = await casaSessionDelete(deps.processManager, casaName(name), sessionId);
      if (deleted) {
        deps.formatter.success("Session deleted");
      } else {
        deps.formatter.error("Session not found");
        process.exitCode = 1;
      }
    });

  sessions
    .command("message")
    .description("Send a message to a session")
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .argument("<content>", "Message content")
    .action(async (name: string, sessionId: string, content: string) => {
      const msg = await casaSessionMessage(
        deps.processManager,
        casaName(name),
        sessionId,
        { role: "user", content },
      );
      deps.formatter.json(msg);
    });

  sessions
    .command("interrupt")
    .description("Interrupt an active session")
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .action(async (name: string, sessionId: string) => {
      const ok = await casaSessionInterrupt(deps.processManager, casaName(name), sessionId);
      if (ok) {
        deps.formatter.success("Session interrupted");
      } else {
        deps.formatter.error("Session is not busy");
        process.exitCode = 1;
      }
    });

  sessions
    .command("rename")
    .description("Rename a session")
    .argument("<name>", "CASA name")
    .argument("<session-id>", "Session ID")
    .argument("<title>", "New title")
    .action(async (name: string, sessionId: string, title: string) => {
      const ok = await casaSessionRename(deps.processManager, casaName(name), sessionId, title);
      if (ok) {
        deps.formatter.success("Session renamed");
      } else {
        deps.formatter.error("Session not found");
        process.exitCode = 1;
      }
    });
}
