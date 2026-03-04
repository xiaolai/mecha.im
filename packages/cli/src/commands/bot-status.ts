import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, readBotConfig, loadBotIdentity, readAuthProfiles } from "@mecha/core";
import { botStatus } from "@mecha/service";
import { readState } from "@mecha/process";
import { join, sep } from "node:path";
import { withErrorHandler } from "../error-handler.js";

export function registerBotStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Show bot status")
    .argument("<name>", "bot name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const info = botStatus(deps.processManager, validated);
      const { token: _, ...safeInfo } = info;

      // Enrich with identity and config info
      const identity = loadBotIdentity(deps.mechaDir, validated);
      const config = readBotConfig(join(deps.mechaDir, validated));

      // Compute parent: any bot whose workspace is an ancestor of this one
      let parent: string | undefined;
      let parentWsLen = 0;
      /* v8 ignore start -- parent scan branches: workspacePath checks */
      if (info.workspacePath) {
        const all = deps.processManager.list();
        for (const other of all) {
          if (other.name === validated) continue;
          if (other.workspacePath && info.workspacePath.startsWith(other.workspacePath + sep)) {
            if (!parent || other.workspacePath.length > parentWsLen) {
              parent = other.name;
              parentWsLen = other.workspacePath.length;
            }
          }
        }
      }
      /* v8 ignore stop */

      const enriched: Record<string, unknown> = { ...safeInfo };
      if (identity) {
        enriched.fingerprint = identity.fingerprint;
      }
      if (config?.expose && config.expose.length > 0) {
        enriched.expose = config.expose;
      }

      // Auth profile info
      /* v8 ignore start -- display enrichment, depends on real bot config + auth store */
      const authProfiles = readAuthProfiles(deps.mechaDir);
      if (config?.auth) {
        const meta = authProfiles.profiles[config.auth];
        if (meta) {
          const expiry = meta.expiresAt !== null ? new Date(meta.expiresAt).toISOString().slice(0, 10) : "never";
          enriched.auth = `${config.auth} (${meta.type}, expires ${expiry})`;
        } else {
          enriched.auth = `${config.auth} (profile missing!)`;
        }
      } else if (config && "auth" in config && config.auth === undefined) {
        // Explicit no-auth (spawned with --no-auth) — don't show default
      } else if (authProfiles.default) {
        enriched.auth = `${authProfiles.default} (default)`;
      }
      /* v8 ignore stop */
      if (parent) {
        enriched.parent = parent;
      }

      // Sandbox info from state.json
      const state = readState(join(deps.mechaDir, validated));
      if (state?.sandboxPlatform) {
        enriched.sandboxPlatform = state.sandboxPlatform;
      }
      if (state?.sandboxMode) {
        enriched.sandboxMode = state.sandboxMode;
      }

      if (deps.formatter.isJson) {
        deps.formatter.json(enriched);
      } else {
        deps.formatter.table(
          ["Field", "Value"],
          Object.entries(enriched).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "-")]),
        );
      }
    }));
}
