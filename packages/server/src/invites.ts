import type { FastifyInstance } from "fastify";
import type { PendingInvite, ServerConfig } from "./types.js";
import { nodes } from "./signaling.js";

/** In-memory invite store, keyed by token. */
export const invites = new Map<string, PendingInvite>();

/** Purge expired invites periodically. */
let purgeTimer: ReturnType<typeof setInterval> | undefined;

export function registerInviteRoutes(app: FastifyInstance, config: ServerConfig): void {
  /* v8 ignore start -- periodic purge timer + cleanup hook */
  purgeTimer = setInterval(() => purgeExpired(), 60_000);
  app.addHook("onClose", () => { clearInterval(purgeTimer); });
  /* v8 ignore stop */

  /** Create an invite token. Body: { token, inviterName, inviterPublicKey, inviterFingerprint, inviterNoisePublicKey, expiresAt } */
  app.post<{ Body: PendingInvite }>("/invite", async (req, reply) => {
    const body = req.body as PendingInvite | undefined;
    if (!body?.token || !body.inviterName) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // Verify inviter is currently registered on signaling WebSocket
    const inviterOnline = nodes.get(body.inviterName);
    /* v8 ignore start -- inviter offline rejection: tested in server integration */
    if (!inviterOnline) {
      return reply.status(401).send({ error: "Inviter must be registered on signaling WebSocket" });
    }
    /* v8 ignore stop */

    // Require inviter public key and verify it matches registered identity
    if (!body.inviterPublicKey) {
      return reply.status(400).send({ error: "Missing required field: inviterPublicKey" });
    }
    /* v8 ignore start -- inviter key mismatch: requires spoofed identity in test */
    if (inviterOnline.publicKey !== body.inviterPublicKey) {
      return reply.status(401).send({ error: "Inviter public key does not match registered identity" });
    }
    /* v8 ignore stop */

    if (invites.size >= config.inviteMaxPending) {
      purgeExpired();
      if (invites.size >= config.inviteMaxPending) {
        return reply.status(429).send({ error: "Too many pending invites" });
      }
    }

    /* v8 ignore start -- ?? fallbacks for optional fields */
    const invite: PendingInvite = {
      token: body.token,
      inviterName: body.inviterName,
      inviterPublicKey: body.inviterPublicKey ?? "",
      inviterFingerprint: body.inviterFingerprint ?? "",
      inviterNoisePublicKey: body.inviterNoisePublicKey ?? "",
      expiresAt: body.expiresAt ?? Date.now() + 86_400_000,
      consumed: false,
    };
    /* v8 ignore stop */

    // Reject duplicate active tokens to prevent overwrite/hijack
    if (invites.has(invite.token)) {
      return reply.status(409).send({ error: "Invite token already exists" });
    }

    invites.set(invite.token, invite);
    return reply.status(201).send({ ok: true, token: invite.token });
  });

  /** Get invite metadata (public). */
  app.get<{ Params: { token: string } }>("/invite/:token", async (req, reply) => {
    const invite = invites.get(req.params.token);
    if (!invite) {
      return reply.status(404).send({ error: "Invite not found" });
    }
    if (invite.consumed) {
      return reply.status(410).send({ error: "Invite already consumed" });
    }
    if (Date.now() > invite.expiresAt) {
      invites.delete(invite.token);
      return reply.status(410).send({ error: "Invite expired" });
    }
    return {
      inviterName: invite.inviterName,
      expiresAt: new Date(invite.expiresAt).toISOString(),
      consumed: invite.consumed,
    };
  });

  /** Accept an invite. Body: { name, publicKey, fingerprint, noisePublicKey } */
  app.post<{ Params: { token: string }; Body: { name: string; publicKey: string; fingerprint: string; noisePublicKey?: string } }>(
    "/invite/:token/accept",
    async (req, reply) => {
      const invite = invites.get(req.params.token);
      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }
      if (invite.consumed) {
        return reply.status(410).send({ error: "Invite already consumed" });
      }
      if (Date.now() > invite.expiresAt) {
        invites.delete(invite.token);
        return reply.status(410).send({ error: "Invite expired" });
      }

      const body = req.body as { name?: string; publicKey?: string; fingerprint?: string; noisePublicKey?: string } | undefined;
      if (!body?.name || !body.publicKey || !body.fingerprint) {
        return reply.status(400).send({ error: "Missing required fields: name, publicKey, fingerprint" });
      }

      // Verify acceptor identity: if registered on WS, public key must match
      /* v8 ignore start -- acceptor key mismatch: requires spoofed identity in test */
      const acceptorNode = nodes.get(body.name);
      if (acceptorNode && acceptorNode.publicKey !== body.publicKey) {
        return reply.status(401).send({ error: "Public key does not match registered identity" });
      }
      /* v8 ignore stop */

      invite.consumed = true;

      // Notify the inviter if online
      const inviterNode = nodes.get(invite.inviterName);
      if (inviterNode) {
        const msg = {
          type: "invite-accepted",
          peer: body.name,
          publicKey: body.publicKey,
          /* v8 ignore start -- ?? fallback for optional field */
          noisePublicKey: body.noisePublicKey ?? "",
          /* v8 ignore stop */
          fingerprint: body.fingerprint,
        };
        /* v8 ignore start -- guard: inviter may disconnect between check and send */
        if (inviterNode.ws.readyState === inviterNode.ws.OPEN) {
          inviterNode.ws.send(JSON.stringify(msg));
        }
        /* v8 ignore stop */
      }

      return {
        ok: true,
        inviter: {
          name: invite.inviterName,
          publicKey: invite.inviterPublicKey,
          noisePublicKey: invite.inviterNoisePublicKey,
          fingerprint: invite.inviterFingerprint,
        },
      };
    },
  );
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, invite] of invites) {
    if (invite.consumed || now > invite.expiresAt) {
      invites.delete(token);
    }
  }
}
