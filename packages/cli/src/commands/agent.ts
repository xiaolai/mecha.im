import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerAgentStartCommand } from "./agent-start.js";
import { registerAgentStatusCommand } from "./agent-status.js";

export function registerAgentCommand(program: Command, deps: CommandDeps): void {
  const agent = program
    .command("agent")
    .description("Manage the agent server");

  registerAgentStartCommand(agent, deps);
  registerAgentStatusCommand(agent, deps);
}
