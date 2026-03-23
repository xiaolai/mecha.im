import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, validateTags, validateCapabilities, validateAddDirs, readAuthProfiles, readBotConfig, AuthProfileNotFoundError } from "@mecha/core";
import { botConfigure } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";
import { isAbsolute, resolve, join } from "node:path";
import { realpathSync } from "node:fs";

/** Register the 'bot configure' subcommand. */
export function registerBotConfigureCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("configure")
    .description("Update bot configuration")
    .argument("<name>", "bot name")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--expose <caps>", "Comma-separated capabilities to expose")
    .option("--auth <profile>", "Auth profile name to use")
    .option("--add-dir <dirs>", "Comma-separated directories to add")
    .option("--remove-dir <dirs>", "Comma-separated directories to remove")
    .action(async (name: string, opts: { tags?: string; expose?: string; auth?: string; addDir?: string; removeDir?: string }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const updates: { tags?: string[]; expose?: string[]; auth?: string; addDirs?: string[] } = {};
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
      // --add-dir / --remove-dir: compute final addDirs array
      const parsedAddDirs = opts.addDir?.split(",").map((d) => d.trim()).filter(Boolean) ?? [];
      const parsedRemoveDirs = opts.removeDir?.split(",").map((d) => d.trim()).filter(Boolean) ?? [];
      // Validate --add-dir paths
      if (parsedAddDirs.length > 0) {
        const result = validateAddDirs(parsedAddDirs, deps.mechaDir);
        if (!result.ok) {
          deps.formatter.error(result.error);
          process.exitCode = 1;
          return;
        }
      }
      // Validate --remove-dir paths (only absolute check — path may not exist anymore)
      for (const d of parsedRemoveDirs) {
        if (!isAbsolute(d)) {
          deps.formatter.error(`Remove path must be absolute: "${d}"`);
          process.exitCode = 1;
          return;
        }
      }
      // Merge: remove first, then add, validate final array
      if (parsedAddDirs.length > 0 || parsedRemoveDirs.length > 0) {
        const currentConfig = readBotConfig(join(deps.mechaDir, validated));
        const currentDirs = currentConfig?.addDirs ?? [];
        const removeSet = new Set(parsedRemoveDirs.map((d) => { try { return realpathSync(resolve(d)); } catch { return resolve(d); } }));
        const afterRemove = currentDirs.filter((d) => !removeSet.has(resolve(d)));
        const merged = [...afterRemove, ...parsedAddDirs.map((p) => resolve(p))];
        // Re-validate the full merged array (enforces MAX_ADD_DIRS on final result)
        const finalResult = validateAddDirs(merged, deps.mechaDir);
        if (!finalResult.ok) {
          deps.formatter.error(finalResult.error);
          process.exitCode = 1;
          return;
        }
        updates.addDirs = finalResult.dirs;
      }

      if (Object.keys(updates).length === 0) {
        deps.formatter.info("Nothing to update");
        return;
      }
      botConfigure(deps.mechaDir, deps.processManager, validated, updates);
      deps.formatter.success(`${validated} updated`);
      if ((parsedAddDirs.length > 0 || parsedRemoveDirs.length > 0) && deps.processManager.get(validated)?.state === "running") {
        deps.formatter.info("Restart bot to apply directory changes");
      }
    }));
}
