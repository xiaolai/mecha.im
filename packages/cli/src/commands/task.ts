import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerTaskCreateCommand } from "./task-create.js";
import { registerTaskListCommand } from "./task-list.js";
import { registerTaskShowCommand } from "./task-show.js";
import { registerTaskCancelCommand } from "./task-cancel.js";

/** Register the 'task' command group. */
export function registerTaskCommand(program: Command, deps: CommandDeps): void {
  const task = program.command("task").description("Manage tasks (bot-to-bot work delegation)");
  registerTaskCreateCommand(task, deps);
  registerTaskListCommand(task, deps);
  registerTaskShowCommand(task, deps);
  registerTaskCancelCommand(task, deps);
}
