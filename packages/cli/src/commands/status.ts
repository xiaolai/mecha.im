import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, readCasaConfig, loadCasaIdentity } from "@mecha/core";
import { casaStatus } from "@mecha/service";
import { join } from "node:path";

export function registerStatusCommand(program: Command, deps: CommandDeps): void {
  program
    .command("status")
    .description("Show CASA status")
    .argument("<name>", "CASA name")
    .action(async (name: string) => {
      const validated = casaName(name);
      const info = casaStatus(deps.processManager, validated);
      const { token: _token, ...safeInfo } = info;

      // Enrich with identity and config info
      const identity = loadCasaIdentity(deps.mechaDir, validated);
      const config = readCasaConfig(join(deps.mechaDir, validated));

      // Compute parent: any CASA whose workspace is an ancestor of this one
      let parent: string | undefined;
      let parentWsLen = 0;
      /* v8 ignore start -- parent scan branches: workspacePath checks */
      if (info.workspacePath) {
        const all = deps.processManager.list();
        for (const other of all) {
          if (other.name === validated) continue;
          if (other.workspacePath && info.workspacePath.startsWith(other.workspacePath + "/")) {
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
      if (parent) {
        enriched.parent = parent;
      }

      deps.formatter.json(enriched);
    });
}
