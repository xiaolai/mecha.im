import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
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
}
