---
description: Security design — writes through Policy, worker isolation, secret handling
globs: "**/*.go"
---

# Security Rules

## All Writes Through Mecha (Phase 5 goal)

The intended architecture routes all GitHub writes through Policy:

```
Worker → mecha → Policy → GitHub
```

Workers *may* receive GitHub tokens via `docker.env` if explicitly configured.
Policy-based write filtering is a Phase 5 feature.

## Workers Are Configurable

- Workers receive credentials via `docker.env` or `docker.token`.
- Any env var is allowed except runtime-reserved keys (`WORKER_BACKEND`, etc.).
- Credential policy (what a worker is allowed to have) is a Phase 5 concern.

### Secret Delivery

- **Phase 2**: LLM API tokens injected directly as container env vars at create time. Acceptable for local/trusted environments.
- **Phase 3+**: Proxy sidecar intercepts outbound API calls, injects credentials, and enforces egress policy. Workers have zero secrets.

## Input Handling

- Use webhook payload, not API refetch (TOCTOU prevention).
- Sanitize all user-provided content before processing.
- Validate branch names with strict regex whitelist.
- Validate file paths with realpath() — no symlink escapes.
- No shell interpolation of user-controlled strings.
- Never inline secrets — always use $ENV_VAR references.
- Redact secrets from logs. See `.claude/rules/secrets.md` — Redaction section for full pattern list.
