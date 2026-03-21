import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createCredentialStore } from "@mecha/gateway";

/** Register the 'secret revoke' subcommand. */
export function registerSecretRevokeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("revoke")
    .description("Revoke a bot's access to a secret")
    .argument("<bot>", "Bot name")
    .argument("<secret>", "Secret name")
    .action((bot: string, secret: string) =>
      withErrorHandler(deps, async () => {
        const store = createCredentialStore(join(deps.mechaDir, "gateway"));
        const removed = store.revokeAccess(secret, bot);

        if (removed) {
          deps.formatter.success(`Revoked "${bot}" access to secret "${secret}"`);
        } else {
          deps.formatter.info(`No grant found for "${bot}" on secret "${secret}"`);
        }
      }),
    );
}
