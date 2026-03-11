import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botActivitySnapshot } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot activity' subcommand. */
export function registerBotActivityCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("activity")
    .description("Show bot activity state")
    .argument("<name>", "bot name")
    .option("-w, --watch", "Stream activity events in real time")
    .action(async (name: string, opts: { watch?: boolean }) => withErrorHandler(deps, async () => {
      const validated = botName(name);

      if (opts.watch) {
        // --watch mode: stream SSE events
        deps.formatter.info(`Watching activity for ${validated}... (Ctrl+C to stop)`);
        const { botActivityStream } = await import("@mecha/service");
        const ac = new AbortController();
        process.on("SIGINT", () => ac.abort());

        try {
          for await (const event of botActivityStream(deps.processManager, validated, ac.signal)) {
            const activity = event.activity as string;
            const toolName = event.toolName ? ` (${event.toolName})` : "";
            const ts = typeof event.timestamp === "string"
              ? new Date(event.timestamp).toLocaleTimeString()
              : "";
            deps.formatter.info(`[${ts}] ${validated}: ${activity}${toolName}`);
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          throw err;
        }
      } else {
        // Snapshot mode
        const snapshot = await botActivitySnapshot(deps.processManager, validated);

        if (deps.formatter.isJson) {
          deps.formatter.json(snapshot);
        } else {
          deps.formatter.table(
            ["Field", "Value"],
            [
              ["name", snapshot.name],
              ["activity", snapshot.activity],
              ["timestamp", snapshot.timestamp],
            ],
          );
        }
      }
    }));
}
