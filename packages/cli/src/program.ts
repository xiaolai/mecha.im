import { Command } from "commander";
import type { CommandDeps } from "./types.js";

/** Create the root mecha CLI program with global flags */
export function createProgram(_deps: CommandDeps): Command {
  const program = new Command();

  program
    .name("mecha")
    .description("Local-first multi-agent runtime")
    .version("0.2.0")
    .option("--json", "Output JSON instead of human-readable", false)
    .option("--quiet", "Minimal output (errors only)", false)
    .option("--verbose", "Detailed output", false)
    .option("--no-color", "Disable colored output");

  // Phase 1 registers: spawn, kill, ls, status, chat, sessions, logs

  return program;
}
