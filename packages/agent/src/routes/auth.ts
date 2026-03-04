import type { FastifyInstance } from "fastify";
import { verifyTotpCode } from "../totp.js";
import { createSessionToken, SESSION_COOKIE } from "../session.js";
import { createLoginLimiter } from "../login-limiter.js";
import { emitEvent, type EventLog } from "../event-log.js";

export interface AuthRouteOpts {
  totpSecret?: string;
  sessionKey?: string;
  sessionTtlHours?: number;
  eventLog?: EventLog;
}

export function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOpts): void {
  const limiter = createLoginLimiter();
  const ttl = opts.sessionTtlHours ?? 24;

  /** Public: returns which auth methods are available. */
  app.get("/auth/status", async () => ({
    methods: {
      totp: !!opts.totpSecret,
    },
  }));

  /** Rate-limited TOTP login → sets session cookie. */
  app.post<{ Body: { code: string } }>("/auth/login", async (request, reply) => {
    if (!opts.totpSecret || !opts.sessionKey) {
      return reply.code(404).send({ error: "TOTP auth not enabled" });
    }

    const { allowed, retryAfterMs } = limiter.check();
    if (!allowed) {
      return reply.code(429).send({
        error: "Too many attempts",
        retryAfterMs,
      });
    }

    const body = request.body as { code?: string } | null;
    const code = body?.code;
    if (!code || typeof code !== "string") {
      return reply.code(400).send({ error: "Missing TOTP code" });
    }

    if (!verifyTotpCode(opts.totpSecret, code)) {
      const locked = limiter.recordFailure();
      if (locked) {
        app.log.warn("TOTP login locked out after %d failed attempts from %s", 5, request.ip);
        if (opts.eventLog) {
          emitEvent(opts.eventLog, "warn", "auth", "totp.lockout",
            `TOTP lockout triggered from ${request.ip}`, { ip: request.ip });
        }
      }
      return reply.code(401).send({ error: "Invalid TOTP code" });
    }

    limiter.reset();
    if (opts.eventLog) {
      emitEvent(opts.eventLog, "info", "auth", "totp.login_success",
        `TOTP login from ${request.ip}`, { ip: request.ip });
    }
    const token = createSessionToken(opts.sessionKey, ttl);
    const maxAge = ttl * 3600;

    /* v8 ignore start -- Secure flag only added for non-localhost; tests run on localhost */
    const secure = request.hostname !== "localhost" && request.hostname !== "127.0.0.1"
      ? "; Secure" : "";
    /* v8 ignore stop */
    reply.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
    );
    return { ok: true };
  });

  /** Clear session cookie. */
  app.post("/auth/logout", async (request, reply) => {
    /* v8 ignore start -- Secure flag only added for non-localhost; tests run on localhost */
    const secure = request.hostname !== "localhost" && request.hostname !== "127.0.0.1"
      ? "; Secure" : "";
    /* v8 ignore stop */
    reply.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    );
    return { ok: true };
  });
}
