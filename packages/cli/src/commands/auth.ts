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
  mechaAuthSwitchBot,
  mechaAuthProbe,
} from "@mecha/service";
import { botName, validateTags } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/* v8 ignore start -- display formatting, tested via auth ls integration */
function formatExpiry(expiresAt: number | null): string {
  if (expiresAt === null) return "never";
  const now = Date.now();
  const remaining = expiresAt - now;
  if (remaining <= 0) return "expired";
  const days = Math.floor(remaining / 86400000);
  const date = new Date(expiresAt).toISOString().slice(0, 10);
  return `${date} (${days}d)`;
}
/* v8 ignore stop */

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
    .action(async (name: string, opts: { oauth?: boolean; apiKey?: boolean; token?: string; tag?: string[] }) => withErrorHandler(deps, async () => {
      if (opts.oauth && opts.apiKey) {
        deps.formatter.error("Cannot use both --oauth and --api-key");
        process.exitCode = 1;
        return;
      }
      if (!opts.oauth && !opts.apiKey) {
        deps.formatter.error("Specify --oauth or --api-key");
        process.exitCode = 1;
        return;
      }
      const type = opts.oauth ? "oauth" : "api-key";
      const token = opts.token;
      if (!token) {
        deps.formatter.error("Token is required (use --token <value>)");
        process.exitCode = 1;
        return;
      }
      let tags = opts.tag;
      /* v8 ignore start -- tag validation branches: valid path is simple passthrough */
      if (tags) {
        const result = validateTags(tags);
        if (!result.ok) {
          deps.formatter.error(result.error);
          process.exitCode = 1;
          return;
        }
        tags = result.tags;
      }
      /* v8 ignore stop */
      const profile = mechaAuthAdd(deps.mechaDir, name, type, token, tags);
      deps.formatter.success(`Added auth profile "${profile.name}" (${profile.type})`);
      if (profile.isDefault) {
        deps.formatter.info("Set as default profile");
      }
    }));

  auth
    .command("ls")
    .description("List auth profiles")
    .action(async () => withErrorHandler(deps, async () => {
      const profiles = mechaAuthLs(deps.mechaDir);
      if (profiles.length === 0) {
        deps.formatter.info("No auth profiles");
        return;
      }
      deps.formatter.table(
        ["Name", "Type", "Account", "Default", "Expires", "Tags"],
        profiles.map((p) => [
          p.name,
          p.type,
          p.account ?? "—",
          p.isDefault ? "✓" : "",
          formatExpiry(p.expiresAt),
          p.tags.join(", "),
        ]),
      );
    }));

  auth
    .command("default")
    .description("Set default auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      mechaAuthDefault(deps.mechaDir, name);
      deps.formatter.success(`Default profile set to "${name}"`);
    }));

  auth
    .command("rm")
    .description("Remove an auth profile")
    .argument("<name>", "Profile name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      mechaAuthRm(deps.mechaDir, name);
      deps.formatter.success(`Removed auth profile "${name}"`);
    }));

  auth
    .command("tag")
    .description("Set tags on an auth profile")
    .argument("<name>", "Profile name")
    .argument("<tags...>", "Tags")
    .action(async (name: string, tags: string[]) => withErrorHandler(deps, async () => {
      const result = validateTags(tags);
      if (!result.ok) {
        deps.formatter.error(result.error);
        process.exitCode = 1;
        return;
      }
      mechaAuthTag(deps.mechaDir, name, result.tags);
      deps.formatter.success(`Tags updated for "${name}"`);
    }));

  auth
    .command("switch")
    .description("Switch auth profile (global default or per-bot)")
    .argument("<name>", "Profile name (or bot name when used with <profile>)")
    .argument("[profile]", "Profile name (when first arg is bot name)")
    .action(async (nameOrBot: string, profile?: string) => withErrorHandler(deps, async () => {
      if (profile) {
        // Per-bot switch: mecha auth switch <bot> <profile>
        const validated = botName(nameOrBot);
        const result = mechaAuthSwitchBot(deps.mechaDir, deps.processManager, validated, profile);
        deps.formatter.success(`${validated} now uses auth profile "${result.name}". Restart to apply.`);
      } else {
        // Global default switch: mecha auth switch <profile>
        const result = mechaAuthSwitch(deps.mechaDir, nameOrBot);
        deps.formatter.success(`Switched to "${result.name}"`);
      }
    }));

  auth
    .command("test")
    .description("Test an auth profile (probes API by default, use --offline for local check)")
    .argument("<name>", "Profile name")
    .option("--offline", "Check token exists without API call")
    .action(async (name: string, opts: { offline?: boolean }) => withErrorHandler(deps, async () => {
      if (opts.offline) {
        const result = mechaAuthTest(deps.mechaDir, name);
        if (result.valid) {
          deps.formatter.success(`Profile "${name}" is valid (offline check)`);
        } else {
          deps.formatter.error(`Profile "${name}" has invalid token`);
          process.exitCode = 1;
        }
        return;
      }
      const result = await mechaAuthProbe(deps.mechaDir, name);
      if (result.valid) {
        deps.formatter.success(`Profile "${name}" is valid (API verified)`);
      } else {
        /* v8 ignore start -- error message formatting */
        const reason = result.error ? `: ${result.error}` : "";
        /* v8 ignore stop */
        deps.formatter.error(`Profile "${name}" failed${reason}`);
        process.exitCode = 1;
      }
    }));

  auth
    .command("renew")
    .description("Renew token for an auth profile")
    .argument("<name>", "Profile name")
    .argument("<token>", "New token value")
    .action(async (name: string, token: string) => withErrorHandler(deps, async () => {
      mechaAuthRenew(deps.mechaDir, name, token);
      deps.formatter.success(`Token renewed for "${name}"`);
    }));
}
