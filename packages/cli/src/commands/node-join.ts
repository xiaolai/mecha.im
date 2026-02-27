import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { loadNodeIdentity, IdentityNotFoundError, addNode, getNode, DuplicateNodeError, createNoiseKeys } from "@mecha/core";
import { readNodeName } from "@mecha/service";
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

      const nodeName = readNodeName(deps.mechaDir);
      if (!nodeName) throw new IdentityNotFoundError("node name (run `mecha node init` first)");

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

      // Ensure X25519 noise keys exist
      const noiseKeys = createNoiseKeys(deps.mechaDir);

      // Accept invite on the rendezvous server (best-effort — notifies inviter if online)
      // Validate URL scheme to prevent SSRF from crafted invites
      const rvUrl = payload.rendezvousUrl;
      if (/^wss?:\/\//i.test(rvUrl)) {
        const serverUrl = rvUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
        try {
          const res = await fetch(`${serverUrl}/invite/${encodeURIComponent(payload.token)}/accept`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: nodeName,
              publicKey: identity.publicKey,
              fingerprint: identity.fingerprint,
              noisePublicKey: noiseKeys.publicKey,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            deps.formatter.info("Invite accepted on server (inviter notified)");
          } else {
            deps.formatter.warn(`Server accept failed (HTTP ${res.status}) — peer added locally`);
          }
        /* v8 ignore start -- network failure is best-effort */
        } catch {
          deps.formatter.warn("Could not reach rendezvous server — peer added locally");
        }
        /* v8 ignore stop */
      } else {
        deps.formatter.warn("Untrusted rendezvous URL scheme in invite — skipping server notification");
      }

      // Remove existing if --force
      if (existing && opts.force) {
        const { removeNode } = await import("@mecha/core");
        removeNode(deps.mechaDir, payload.inviterName);
      }

      // Add peer to registry as managed node
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
    }));
}
