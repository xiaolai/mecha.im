import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerSecretSetCommand } from "./secret-set.js";
import { registerSecretListCommand } from "./secret-list.js";
import { registerSecretGrantCommand } from "./secret-grant.js";
import { registerSecretRevokeCommand } from "./secret-revoke.js";

/** Register the 'secret' command group. */
export function registerSecretCommand(program: Command, deps: CommandDeps): void {
  const secret = program
    .command("secret")
    .description("Manage secrets and access grants");

  registerSecretSetCommand(secret, deps);
  registerSecretListCommand(secret, deps);
  registerSecretGrantCommand(secret, deps);
  registerSecretRevokeCommand(secret, deps);
}
