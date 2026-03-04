import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, validateTags, validateCapabilities, readAuthProfiles, AuthProfileNotFoundError } from "@mecha/core";
import { botConfigure } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerBotConfigureCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("configure")
    .description("Update bot configuration")
    .argument("<name>", "bot name")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--expose <caps>", "Comma-separated capabilities to expose")
    .option("--auth <profile>", "Auth profile name to use")
    .action(async (name: string, opts: { tags?: string; expose?: string; auth?: string }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const updates: { tags?: string[]; expose?: string[]; auth?: string } = {};
      if (opts.tags) {
        const result = validateTags(opts.tags.split(",").map((t) => t.trim()).filter(Boolean));
        if (!result.ok) {
          deps.formatter.error(result.error);
          process.exitCode = 1;
          return;
        }
        updates.tags = result.tags;
      }
      if (opts.expose) {
        const capResult = validateCapabilities(opts.expose.split(",").map((c) => c.trim()).filter(Boolean));
        if (!capResult.ok) {
          deps.formatter.error(capResult.error);
          process.exitCode = 1;
          return;
        }
        updates.expose = capResult.capabilities;
      }
      if (opts.auth) {
        const store = readAuthProfiles(deps.mechaDir);
        if (!store.profiles[opts.auth]) {
          throw new AuthProfileNotFoundError(opts.auth);
        }
        updates.auth = opts.auth;
      }
      if (Object.keys(updates).length === 0) {
        deps.formatter.info("Nothing to update");
        return;
      }
      botConfigure(deps.mechaDir, deps.processManager, validated, updates);
      deps.formatter.success(`${validated} updated`);
    }));
}
