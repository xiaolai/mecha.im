import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { loadNodeIdentity, IdentityNotFoundError, addNode, getNode, DuplicateNodeError } from "@mecha/core";
import { parseInviteCode } from "@mecha/connect";

export function registerNodeJoinCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("join")
    .description("Accept an invite and connect to a peer")
    .argument("<code>", "Invite code (mecha://invite/...)")
    .option("--force", "Overwrite if peer already in registry", false)
    .action(async (code: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const identity = loadNodeIdentity(deps.mechaDir);
      if (!identity) throw new IdentityNotFoundError("node");

      // Parse and validate invite (checks expiry, signature)
      const payload = parseInviteCode(code);

      // Check for self-invite (compare by fingerprint — more reliable than name)
      if (payload.inviterFingerprint === identity.fingerprint) {
        deps.formatter.error("Cannot accept own invite");
        process.exitCode = 1;
        return;
      }

      // Check for duplicate
      const existing = getNode(deps.mechaDir, payload.inviterName);
      if (existing && !opts.force) {
        throw new DuplicateNodeError(payload.inviterName);
      }

      // Add peer to registry as managed node
      if (existing && opts.force) {
        // Remove existing first, then re-add
        const { removeNode } = await import("@mecha/core");
        removeNode(deps.mechaDir, payload.inviterName);
      }

      addNode(deps.mechaDir, {
        name: payload.inviterName,
        host: "",
        port: 0,
        apiKey: "",
        publicKey: payload.inviterPublicKey,
        noisePublicKey: payload.inviterNoisePublicKey,
        fingerprint: payload.inviterFingerprint,
        addedAt: new Date().toISOString(),
        managed: true,
      });

      deps.formatter.success(`Peer added: ${payload.inviterName} (managed)`);
      deps.formatter.info("Direct P2P connection requires rendezvous infrastructure deployment.");
    }));
}
