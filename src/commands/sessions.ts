import type { Command } from "commander";
import { requireValidName } from "../cli-utils.js";
import { printTable } from "../cli.utils.js";
import { botApiJson } from "./bot-api.js";

interface SessionSummary {
  id: string;
  title?: string;
  model?: string;
  created?: string;
  messages?: number;
}

export function registerSessionsCommand(program: Command): void {
  program
    .command("sessions <name> [sessionId]")
    .description("Browse Claude Code conversation history")
    .option("--json", "Output as JSON")
    .option("--search <query>", "Search sessions by content")
    .option("--log", "Show full conversation log (with session ID)")
    .action(async (name: string, sessionId: string | undefined, opts) => {
      requireValidName(name);

      // Search mode
      if (opts.search) {
        const results = await botApiJson<SessionSummary[]>(name, `/sessions/search?q=${encodeURIComponent(opts.search)}`);
        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          console.log("No sessions found matching your search.");
        } else {
          printTable(
            ["ID", "TITLE", "MODEL", "MSGS", "CREATED"],
            results.map(s => [s.id.slice(0, 8), s.title ?? "-", s.model ?? "-", String(s.messages ?? "-"), s.created ?? "-"]),
          );
        }
        return;
      }

      // Single session detail
      if (sessionId) {
        const session = await botApiJson<Record<string, unknown>>(name, `/sessions/${sessionId}`);

        if (opts.log && typeof session === "object" && session !== null) {
          // Full conversation log
          const messages = (session as Record<string, unknown>).messages;
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              const m = msg as Record<string, unknown>;
              const role = String(m.role ?? "unknown");
              const content = String(m.content ?? "");
              console.log(`[${role}] ${content}\n`);
            }
          } else {
            console.log(JSON.stringify(session, null, 2));
          }
        } else {
          console.log(JSON.stringify(session, null, 2));
        }
        return;
      }

      // List sessions
      const sessions = await botApiJson<SessionSummary[]>(name, "/sessions");

      if (opts.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        console.log(`No sessions found for "${name}".`);
        return;
      }

      printTable(
        ["ID", "TITLE", "MODEL", "MSGS", "CREATED"],
        sessions.map(s => [s.id.slice(0, 8), s.title ?? "-", s.model ?? "-", String(s.messages ?? "-"), s.created ?? "-"]),
      );
    });
}
