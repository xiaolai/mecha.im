import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'sandbox' command. */
export function registerSandboxCommand(program: Command, deps: CommandDeps): void {
  const sandbox = program
    .command("sandbox")
    .description("Sandbox management");

  sandbox
    .command("show")
    .description("Show sandbox profile for a bot")
    .argument("<name>", "bot name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const profilePath = join(deps.mechaDir, validated, "sandbox-profile.json");
      if (!existsSync(profilePath)) {
        deps.formatter.warn(`No sandbox profile found for "${validated}"`);
        return;
      }
      try {
        const raw = readFileSync(profilePath, "utf-8");
        const profile: unknown = JSON.parse(raw);
        deps.formatter.json(profile);
      } catch {
        deps.formatter.error(`Failed to read sandbox profile for "${validated}"`);
        process.exitCode = 1;
      }
    }));
}
