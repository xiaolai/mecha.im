import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botChat } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot chat' subcommand. */
export function registerBotChatCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("chat")
    .description("Chat with a bot")
    .argument("<name>", "bot name")
    .argument("<message>", "Message to send")
    .option("-s, --session <id>", "Session ID")
    .action(async (name: string, message: string, opts: { session?: string }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const result = await botChat(deps.processManager, validated, {
        message,
        sessionId: opts.session,
      });
      process.stdout.write(result.response + "\n");
      deps.formatter.info(`Session: ${result.sessionId}`);
    }));
}
