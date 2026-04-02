---
description: Keep .claude/rules/ in sync with source code changes
globs: ["internal/**/*.go", "docker/runtime/**/*.ts", "go.mod", "Makefile"]
---

# Rules Sync

When you modify source files, check the corresponding rules file for staleness.
If the rules file makes claims that no longer match the code, fix the rules file
in the same commit.

## Dependency Map

| When you change... | Check this rules file |
|---|---|
| `internal/worker/config.go` (struct fields) | `worker-yaml-spec.md` — YAML fields, Docker config |
| `internal/worker/secrets.go` (token detection) | `secrets.md` — prefix table, resolution order |
| `internal/worker/container.go` (env/mounts) | `secrets.md` — resolution order, HOME logic |
| `internal/worker/validate.go` (sensitive paths) | `worker-yaml-spec.md` — blocked paths |
| `internal/worker/types.go` (State enum) | `worker-design.md` — state machine |
| `internal/worker/redact.go` (patterns) | `secrets.md` — redaction patterns list |
| `internal/source/source.go` (interfaces) | `domain-model.md` — provider interfaces table |
| `internal/source/slack.go` (Slack source) | `secrets.md` — Slack signing_secret field |
| `internal/source/telegram.go` (Telegram source) | `secrets.md` — Telegram secret_token field |
| `internal/source/gitlab_respond.go` (responder) | `domain-model.md` — responder capabilities |
| `internal/event/types.go` (Event struct) | `domain-model.md` — event model fields |
| `internal/event/dedup.go` (dedup enforcement) | `domain-model.md` — DedupKey description |
| `internal/task/retry.go` (retry logic) | `domain-model.md` — Task verbs |
| `internal/worker/config_server.go` (ServerConfig) | website `server.md` — config file section |
| `cmd/mecha-mcp/tools.go` (orchestration tools) | website `mcp-server.md` — tool list |
| `internal/policy/result.go` (Result struct) | `result-contract.md` — JSON example |
| `internal/adapter/*.go` (adapter types) | `worker-design.md` — adapter section |
| `internal/cli/helpers.go` (reserved env vars) | `security.md` — reserved keys list |
| `docker/runtime/backends/claude.ts` (env vars) | `worker-yaml-spec.md` — Claude env var table |
| `docker/runtime/types.ts` (TaskResponse) | `result-contract.md` — JSON fields |
| `docker/runtime/entrypoint.sh` (CLI install) | `worker-yaml-spec.md` — image contract |
| `go.mod` (dependencies) | `go-conventions.md` — dependency list |
| `Makefile` (targets) | commands `phase.md`, `bump.md`, `release.md` |

## What to check

1. **Struct fields**: every `yaml:` tag in the Go struct should appear in the rules spec
2. **Env vars**: every `process.env.X` in TypeScript should appear in the env var table
3. **Phase labels**: if code now exists, remove "Phase N" or "planned" labels
4. **Interface counts**: if you add/remove an interface, update the table
5. **Path references**: if you rename a directory, grep rules for the old name
