import type { Command } from "commander";

/** Add --node <name> option to a command. */
export function withNodeOption(cmd: Command): Command {
  return cmd.option(
    "--node <name>",
    "Target a specific remote node (default: auto-detect local then remote)",
  );
}
