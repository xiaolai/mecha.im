import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBotSpawnCommand } from "./bot-spawn.js";
import { registerBotStartCommand } from "./bot-start.js";
import { registerBotStopCommand } from "./bot-stop.js";
import { registerBotKillCommand } from "./bot-kill.js";
import { registerBotRestartCommand } from "./bot-restart.js";
import { registerBotRemoveCommand } from "./bot-remove.js";
import { registerBotLsCommand } from "./bot-ls.js";
import { registerBotStatusCommand } from "./bot-status.js";
import { registerBotLogsCommand } from "./bot-logs.js";
import { registerBotConfigureCommand } from "./bot-configure.js";
import { registerBotFindCommand } from "./bot-find.js";
import { registerBotChatCommand } from "./bot-chat.js";
import { registerBotSessionsCommand } from "./bot-sessions.js";
import { registerBotStopAllCommand } from "./bot-stop-all.js";
import { registerBotRestartAllCommand } from "./bot-restart-all.js";
import { registerBotActivityCommand } from "./bot-activity.js";

/** Register the 'bot' command group. */
export function registerBotCommand(program: Command, deps: CommandDeps): void {
  const bot = program
    .command("bot")
    .description("Manage bot processes");

  registerBotSpawnCommand(bot, deps);
  registerBotStartCommand(bot, deps);
  registerBotStopCommand(bot, deps);
  registerBotKillCommand(bot, deps);
  registerBotRestartCommand(bot, deps);
  registerBotRemoveCommand(bot, deps);
  registerBotLsCommand(bot, deps);
  registerBotStatusCommand(bot, deps);
  registerBotLogsCommand(bot, deps);
  registerBotConfigureCommand(bot, deps);
  registerBotFindCommand(bot, deps);
  registerBotChatCommand(bot, deps);
  registerBotSessionsCommand(bot, deps);
  registerBotStopAllCommand(bot, deps);
  registerBotRestartAllCommand(bot, deps);
  registerBotActivityCommand(bot, deps);
}
