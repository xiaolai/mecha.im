import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createCredentialStore } from "@mecha/gateway";

/** Register the 'secret list' subcommand. */
export function registerSecretListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .description("List stored secrets")
    .action(() =>
      withErrorHandler(deps, async () => {
        const store = createCredentialStore(join(deps.mechaDir, "gateway"));
        const names = store.listSecrets();

        if (names.length === 0) {
          deps.formatter.info("No secrets stored");
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(names);
          return;
        }

        deps.formatter.table(["Name"], names.map((n) => [n]));
      }),
    );
}
