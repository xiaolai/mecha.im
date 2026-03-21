import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createCredentialStore } from "@mecha/gateway";

/** Register the 'secret set' subcommand. */
export function registerSecretSetCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("set")
    .description("Store a secret")
    .argument("<name>", "Secret name")
    .argument("<value>", "Secret value")
    .action((name: string, value: string) =>
      withErrorHandler(deps, async () => {
        const store = createCredentialStore(join(deps.mechaDir, "gateway"));
        store.setSecret(name, value);
        deps.formatter.success(`Secret "${name}" stored`);
      }),
    );
}
