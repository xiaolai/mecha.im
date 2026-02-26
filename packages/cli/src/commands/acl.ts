import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { isValidAddress, isCapability, InvalidCapabilityError, InvalidAddressError } from "@mecha/core";
import type { Capability } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerAclCommand(program: Command, deps: CommandDeps): void {
  const acl = program
    .command("acl")
    .description("Manage inter-CASA permissions");

  acl
    .command("grant")
    .description("Grant capability from source to target")
    .argument("<source>", "Source CASA name or address (name@node)")
    .argument("<cap>", "Capability to grant")
    .argument("<target>", "Target CASA name or address (name@node)")
    .action(async (source: string, cap: string, target: string) => withErrorHandler(deps, async () => {
      if (!isValidAddress(source)) throw new InvalidAddressError(source);
      if (!isValidAddress(target)) throw new InvalidAddressError(target);
      if (!isCapability(cap)) {
        throw new InvalidCapabilityError(cap);
      }
      deps.acl.grant(source, target, [cap as Capability]);
      deps.acl.save();
      deps.formatter.success(`Granted ${source} → ${target} (${cap})`);
    }));

  acl
    .command("revoke")
    .description("Revoke capability from source to target")
    .argument("<source>", "Source CASA name or address (name@node)")
    .argument("<cap>", "Capability to revoke")
    .argument("<target>", "Target CASA name or address (name@node)")
    .action(async (source: string, cap: string, target: string) => withErrorHandler(deps, async () => {
      if (!isValidAddress(source)) throw new InvalidAddressError(source);
      if (!isValidAddress(target)) throw new InvalidAddressError(target);
      if (!isCapability(cap)) {
        throw new InvalidCapabilityError(cap);
      }
      deps.acl.revoke(source, target, [cap as Capability]);
      deps.acl.save();
      deps.formatter.success(`Revoked ${source} → ${target} (${cap})`);
    }));

  acl
    .command("show")
    .description("Show ACL rules")
    .argument("[name]", "Filter by CASA name")
    .action(async (name?: string) => withErrorHandler(deps, async () => {
      const rules = deps.acl.listRules();
      const filtered = name
        ? rules.filter((r) =>
            r.source === name || r.target === name
            || r.source.split("@")[0] === name || r.target.split("@")[0] === name)
        : rules;

      if (filtered.length === 0) {
        deps.formatter.info(name ? `No ACL rules for "${name}"` : "No ACL rules");
        return;
      }

      deps.formatter.table(
        ["Source", "Target", "Capabilities"],
        filtered.map((r) => [r.source, r.target, r.capabilities.join(", ")]),
      );
    }));
}
