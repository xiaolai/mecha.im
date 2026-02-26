import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { loadNodeIdentity, loadNodePrivateKey, IdentityNotFoundError, DEFAULTS } from "@mecha/core";
import { readNodeName } from "@mecha/service";
import { createInviteCode } from "@mecha/connect";

function parseDuration(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Invalid duration: "${duration}" (use format like 1h, 6h, 24h, 7d)`);
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit]!;
}

export function registerNodeInviteCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("invite")
    .description("Create a one-time invite code")
    .option("--expires <duration>", "Invite expiry (default: 24h). Accepts: 1h, 6h, 24h, 7d", "24h")
    .action(async (opts: { expires: string }) => withErrorHandler(deps, async () => {
      const identity = loadNodeIdentity(deps.mechaDir);
      if (!identity) throw new IdentityNotFoundError("node");

      const nodeName = readNodeName(deps.mechaDir);
      if (!nodeName) throw new IdentityNotFoundError("node name (run `mecha node init` first)");

      const privateKey = loadNodePrivateKey(deps.mechaDir);
      /* v8 ignore start -- privateKey always exists when identity exists */
      if (!privateKey) throw new IdentityNotFoundError("node private key");
      /* v8 ignore stop */

      const expiresIn = parseDuration(opts.expires);

      // Phase 6 MVP: invite creation is local-only (no rendezvous server needed).
      // The client param is reserved for future server-side token registration.
      // The noisePublicKey is a placeholder — real X25519 keys are negotiated
      // during the Noise IK handshake when an actual connection is established.
      const result = await createInviteCode({
        client: undefined as never,
        identity,
        nodeName,
        noisePublicKey: "pending",
        privateKey,
        rendezvousUrl: DEFAULTS.RENDEZVOUS_URL,
        opts: { expiresIn },
      });

      deps.formatter.success(result.code);
      deps.formatter.info(`Expires: ${result.expiresAt} (${opts.expires})`);
      deps.formatter.info("Share this code with your peer.");
    }));
}
