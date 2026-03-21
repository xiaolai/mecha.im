import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createCredentialStore } from "@mecha/gateway";

/** Register the 'secret grant' subcommand. */
export function registerSecretGrantCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("grant")
    .description("Grant a bot access to a secret")
    .argument("<bot>", "Bot name")
    .argument("<secret>", "Secret name")
    .action((bot: string, secret: string) =>
      withErrorHandler(deps, async () => {
        const store = createCredentialStore(join(deps.mechaDir, "gateway"));
        store.grantAccess(secret, bot);
        deps.formatter.success(`Granted "${bot}" access to secret "${secret}"`);
      }),
    );
}
