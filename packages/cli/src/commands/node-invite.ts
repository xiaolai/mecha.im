import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { loadNodeIdentity, loadNodePrivateKey, IdentityNotFoundError, DEFAULTS, createNoiseKeys, readServerState } from "@mecha/core";
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

/** Convert ws:// URL to http:// for REST calls. */
function wsToHttp(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

export function registerNodeInviteCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("invite")
    .description("Create a one-time invite code")
    .option("--expires <duration>", "Invite expiry (default: 24h). Accepts: 1h, 6h, 24h, 7d", "24h")
    .option("--server <url>", "Rendezvous server URL (overrides default)")
    .action(async (opts: { expires: string; server?: string }) => withErrorHandler(deps, async () => {
      const identity = loadNodeIdentity(deps.mechaDir);
      if (!identity) throw new IdentityNotFoundError("node");

      const nodeName = readNodeName(deps.mechaDir);
      if (!nodeName) throw new IdentityNotFoundError("node name (run `mecha node init` first)");

      const privateKey = loadNodePrivateKey(deps.mechaDir);
      /* v8 ignore start -- privateKey always exists when identity exists */
      if (!privateKey) throw new IdentityNotFoundError("node private key");
      /* v8 ignore stop */

      // Ensure X25519 noise keys exist (created during node init, but ensure for older inits)
      const noiseKeys = createNoiseKeys(deps.mechaDir);

      const expiresIn = parseDuration(opts.expires);

      // Build rendezvous URL list: embedded server → central fallback
      const centralUrl = opts.server ?? DEFAULTS.RENDEZVOUS_URL;
      let rendezvousUrls: string[];

      const serverState = readServerState(deps.mechaDir);
      /* v8 ignore start -- embedded server state branch: requires running embedded server */
      if (serverState) {
        const localUrl = serverState.publicAddr ?? `ws://localhost:${serverState.port}`;
        rendezvousUrls = [localUrl, centralUrl];
      } else {
      /* v8 ignore stop */
        rendezvousUrls = [centralUrl];
      }

      /* v8 ignore start -- rendezvousUrls[0] always exists since array is non-empty */
      const rendezvousUrl = rendezvousUrls[0]!;
      /* v8 ignore stop */

      // Create signed invite code (local cryptographic operation)
      const result = await createInviteCode({
        identity,
        nodeName,
        noisePublicKey: noiseKeys.publicKey,
        privateKey,
        rendezvousUrl,
        /* v8 ignore start -- ternary: single-URL path returns undefined */
        rendezvousUrls: rendezvousUrls.length > 1 ? rendezvousUrls : undefined,
        /* v8 ignore stop */
        opts: { expiresIn },
      });

      // Register invite on the rendezvous server (best-effort — invite works offline too)
      const serverUrl = wsToHttp(rendezvousUrl);
      try {
        const res = await fetch(`${serverUrl}/invite`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: result.token,
            inviterName: nodeName,
            inviterPublicKey: identity.publicKey,
            inviterFingerprint: identity.fingerprint,
            inviterNoisePublicKey: noiseKeys.publicKey,
            expiresAt: Date.now() + expiresIn * 1000,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          deps.formatter.warn(`Server registration failed (HTTP ${res.status}) — invite still works for offline exchange`);
        }
      /* v8 ignore start -- network failure is best-effort */
      } catch {
        deps.formatter.warn("Could not reach rendezvous server — invite still works for offline exchange");
      }
      /* v8 ignore stop */

      deps.formatter.success(result.code);
      deps.formatter.info(`Expires: ${result.expiresAt} (${opts.expires})`);
      deps.formatter.info("Share this code with your peer.");
    }));
}
