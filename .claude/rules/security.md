---
description: Security invariants — all GitHub writes through mecha, workers never get tokens
globs: "**/*.go"
---

# Security Rules

## All Writes Through Mecha

Workers never talk to GitHub. Mecha is the only thing that writes.

```
Worker → mecha → Policy → GitHub
```

Never:

```
Worker → GitHub
```

## Workers Are Isolated

- No GitHub token in worker containers. Period.
- Worker knows mecha callback URL, not GitHub.
- All GitHub writes go through Policy first.

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
