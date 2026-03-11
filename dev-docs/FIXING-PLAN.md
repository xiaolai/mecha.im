# Mecha Fixing Plan

Based on grill-report-2026-03-11.md. All items trace back to specific findings.

## Phase 1: Critical Security (P0)

- [x] 1.1 `agent/types.ts` — Changed default permission_mode from "bypassPermissions" to "default"
- [x] 1.2 `src/docker.ts` — Auto-generate MECHA_BOT_TOKEN per bot, pass in container env
- [x] 1.3 `src/store.ts` — Added botToken field to registry schema; chmod 0600 on mecha.json
- [x] 1.4 `src/dashboard-server.ts` — Auto-generate dashboard token if not set; fixed .catch(()=>{}) in restart; fixed config_path symlink (realpathSync); bound to 127.0.0.1; added redirect:"manual" to proxy; added CORS
- [x] 1.5 `src/auth.ts` — Fixed catch-all: only catches AuthProfileNotFoundError now
- [x] 1.6 `agent/entry.ts` — Added unhandledRejection/uncaughtException handlers; validated MECHA_PORT; added graceful shutdown timeout (5s)
- [x] 1.7 `src/cli.ts` — Added unhandledRejection handler; fixed headscale pull error message; pass bot token to chat command

## Phase 2: Container Security

- [x] 2.1 `Dockerfile` — Multi-arch s6-overlay (TARGETARCH); /state /app owned by appuser
- [x] 2.2 `s6/mecha-agent/run` — Drop privileges to appuser via s6-setuidgid
- [x] 2.3 `s6/tailscale-up/up` — Use TS_AUTHKEY env var instead of --auth-key flag

## Phase 3: Agent Hardening

- [x] 3.1 `agent/server.ts` — Converted requireAuth to Hono middleware; fixed TOCTOU busy check (tryAcquire); added CORS
- [x] 3.2 `agent/webhook.ts` — Enforced body size limit in unsigned path (read as text, check length)
- [x] 3.3 `agent/event-log.ts` — Fixed readEvents: distinguish ENOENT from other errors; added log rotation (10MB max, 5 files)
- [x] 3.4 `agent/tools/mecha-call.ts` — Include MECHA_BOT_TOKEN as Bearer auth in bot-to-bot calls
- [x] 3.5 `agent/scheduler.ts` — Fixed nextRunAt: jobs stored in Map keyed by entry ID (no fragile index correlation)
- [x] 3.6 `shared/mutex.ts` — Added tryAcquire() method for non-blocking acquire

## Phase 4: Observability

- [x] 4.1 Replaced console.* with structured log.* across: agent/entry.ts, agent/server.ts, agent/scheduler.ts, agent/event-log.ts, agent/costs.ts, agent/session.ts, agent/tools/mecha-call.ts, src/docker.ts, src/dashboard-server.ts, src/store.ts, src/auth.ts
- [x] 4.2 Added REDACT_KEYS: "access_token", "apikey", "auth_key" to shared/logger.ts

## Verification

- [x] 5.1 `npm run build` — clean compilation (tsc -b)
- [x] 5.2 Zero console.* calls in agent/ (all replaced with structured logger)
- [x] 5.3 Only CLI user-facing console.* remain in src/cli.ts (appropriate for CLI tool)

## Summary of Changes

**17 files modified** across 4 phases:

| File | Changes |
|------|---------|
| `agent/types.ts` | Default permission_mode → "default" |
| `agent/entry.ts` | Crash handlers, port validation, graceful shutdown, structured logging |
| `agent/server.ts` | Auth middleware, CORS, TOCTOU fix (tryAcquire), structured logging |
| `agent/webhook.ts` | Body size enforcement in unsigned path |
| `agent/event-log.ts` | Log rotation (10MB), ENOENT distinction, structured logging |
| `agent/scheduler.ts` | Jobs Map (no index correlation bug), structured logging |
| `agent/session.ts` | Structured logging |
| `agent/costs.ts` | Structured logging |
| `agent/tools/mecha-call.ts` | Bot-to-bot auth (Bearer token), structured logging |
| `shared/mutex.ts` | Added tryAcquire() |
| `shared/logger.ts` | Additional redaction keys |
| `src/docker.ts` | Auto-generate bot token, structured logging |
| `src/store.ts` | botToken in registry, chmod 0600 mecha.json, structured logging |
| `src/auth.ts` | Selective catch (not bare catch), structured logging |
| `src/dashboard-server.ts` | Auto-generate token, CORS, symlink fix, localhost binding, redirect:manual, selective restart catch |
| `src/cli.ts` | Unhandled rejection handler, headscale pull fix, bot token in chat |
| `Dockerfile` | Multi-arch s6-overlay, appuser ownership |
| `s6/mecha-agent/run` | s6-setuidgid appuser |
| `s6/tailscale-up/up` | TS_AUTHKEY env var |
