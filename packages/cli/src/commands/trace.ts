import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerTraceShowCommand } from "./trace-show.js";
import { registerTraceListCommand } from "./trace-list.js";

/** Register the 'trace' command group. */
export function registerTraceCommand(program: Command, deps: CommandDeps): void {
  const trace = program
    .command("trace")
    .description("View workflow execution traces");

  registerTraceShowCommand(trace, deps);
  registerTraceListCommand(trace, deps);
}
