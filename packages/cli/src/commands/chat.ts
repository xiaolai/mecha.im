import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaChat } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerChatCommand(program: Command, deps: CommandDeps): void {
  program
    .command("chat")
    .description("Chat with a CASA")
    .argument("<name>", "CASA name")
    .argument("<message>", "Message to send")
    .option("-s, --session <id>", "Session ID")
    .action(async (name: string, message: string, opts: { session?: string }) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      const stream = await casaChat(deps.processManager, validated, {
        message,
        sessionId: opts.session,
      });
      for await (const event of stream) {
        if (event.type === "text" && event.content) {
          process.stdout.write(event.content);
        }
        if (event.type === "done") {
          process.stdout.write("\n");
          deps.formatter.info(`Session: ${event.sessionId}`);
        }
      }
    }));
}
