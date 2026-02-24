import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import {
  mechaAuthAdd,
  mechaAuthLs,
  mechaAuthDefault,
  mechaAuthRm,
  mechaAuthTag,
  mechaAuthSwitch,
  mechaAuthTest,
  mechaAuthRenew,
} from "@mecha/service";

export function registerAuthCommand(program: Command, deps: CommandDeps): void {
  const auth = program
    .command("auth")
    .description("Manage auth profiles");

  auth
    .command("add")
    .description("Add an auth profile")
    .argument("<name>", "Profile name")
    .option("--oauth", "OAuth token type")
    .option("--api-key", "API key type")
    .option("--token <token>", "Token value")
    .option("--tag <tags...>", "Tags for the profile")
    .action(async (name: string, opts: { oauth?: boolean; apiKey?: boolean; token?: string; tag?: string[] }) => {
      if (opts.oauth && opts.apiKey) {
        deps.formatter.error("Cannot use both --oauth and --api-key");
        process.exitCode = 1;
        return;
      }
      const type = opts.oauth ? "oauth" : "api-key";
      const token = opts.token ?? "";
      const profile = mechaAuthAdd(deps.mechaDir, name, type, token, opts.tag);
      deps.formatter.success(`Added auth profile "${profile.name}" (${profile.type})`);
      if (profile.isDefault) {
        deps.formatter.info("Set as default profile");
      }
    });

  auth
    .command("ls")
    .description("List auth profiles")
    .action(async () => {
      const profiles = mechaAuthLs(deps.mechaDir);
      if (profiles.length === 0) {
        deps.formatter.info("No auth profiles");
        return;
      }
      deps.formatter.table(
        ["Name", "Type", "Default", "Tags"],
        profiles.map((p) => [p.name, p.type, p.isDefault ? "✓" : "", p.tags.join(", ")]),
      );
    });

  auth
    .command("default")
    .description("Set default auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => {
      mechaAuthDefault(deps.mechaDir, name);
      deps.formatter.success(`Default profile set to "${name}"`);
    });

  auth
    .command("rm")
    .description("Remove an auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => {
      mechaAuthRm(deps.mechaDir, name);
      deps.formatter.success(`Removed auth profile "${name}"`);
    });

  auth
    .command("tag")
    .description("Set tags on an auth profile")
    .argument("<name>", "Profile name")
    .argument("<tags...>", "Tags")
    .action(async (name: string, tags: string[]) => {
      mechaAuthTag(deps.mechaDir, name, tags);
      deps.formatter.success(`Tags updated for "${name}"`);
    });

  auth
    .command("switch")
    .description("Switch active auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => {
      const profile = mechaAuthSwitch(deps.mechaDir, name);
      deps.formatter.success(`Switched to "${profile.name}"`);
    });

  auth
    .command("test")
    .description("Test an auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => {
      const result = mechaAuthTest(deps.mechaDir, name);
      if (result.valid) {
        deps.formatter.success(`Profile "${name}" is valid`);
      } else {
        deps.formatter.error(`Profile "${name}" has invalid token`);
        process.exitCode = 1;
      }
    });

  auth
    .command("renew")
    .description("Renew token for an auth profile")
    .argument("<name>", "Profile name")
    .argument("<token>", "New token value")
    .action(async (name: string, token: string) => {
      mechaAuthRenew(deps.mechaDir, name, token);
      deps.formatter.success(`Token renewed for "${name}"`);
    });
}
