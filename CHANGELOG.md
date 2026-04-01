# Changelog

All notable changes to mecha are documented here.

## v0.5.14 (unreleased)

- **Secret redaction**: GET /workers API redacts env values, token, api_key
- **Idempotent dispatch**: dedup_key prevents duplicate write-back on crash recovery (schema V4)
- **Observability**: expvar metrics (tasks, dispatch latency, queue depth, write-back) + trace IDs
- **Cron trigger**: first Trigger interface implementation — fires events on interval
- **GitLab responder**: post comments back to MRs/issues via GitLab API
- **Registry reconciliation**: periodic health check detects container drift
- **MCP server expanded**: 6 tools (was 3), loads rules + examples, split into 4 files
- Testing: IsSensitivePath edge cases, TS runtime tests, Docker tests in CI
- CI: docker job builds image and runs integration tests

## v0.5.13

- 8 Docker integration tests: runtime CLI install, Codex MCP detection, credential mounts, plugin env vars, health transitions
- 7 unit test files: IsSensitivePath, deep copy, credentials+token exclusion, extractHost, ResolveCwd, plugin YAML
- Fix: Dockerfile missing `HOME` env var
- Fix: `BUN_INSTALL` for writable bun global dir
- Fix: Codex installed via local `bun add` + symlink (`bun install -g` EACCES)
- Fix: `extractHost` returns `""` for `unix://` sockets

## v0.5.12

- **Unified worker image**: Claude + Codex in single `mecha-worker` Docker image
- **Dual-agent MCP wiring**: Claude as primary, Codex as MCP child process (`codex mcp-server`)
- **Plugin support**: `docker.plugins` and `docker.plugin_marketplaces` in worker YAML
- **Runtime CLI install**: CLIs installed at container start time (always latest)
- `docker.credentials` changed from `string` to `[]string` for dual credential mounts
- `credentials` + `token` mutual exclusion enforced in validation
- `IsSensitivePath` blocks home directory itself as cwd
- Deep copy fixes: `StartedAt` pointer, `Credentials` slice, `[]any` recursive
- `Endpoint()` handles remote Docker hosts (`docker.host` and `DOCKER_HOST`)
- Permission mode defaults to `bypassPermissions` (SDK default)
- Removed standalone Codex and Gemini Docker images
- `DetectTokenEnvVar`: `sk-` prefix maps to `CODEX_API_KEY` (not `OPENAI_API_KEY`)

## v0.5.11

- Universal event architecture with provider-neutral event model
- Event model: Source, Type, Actor, Subject, Attrs, DedupKey
- Provider interfaces: Source, Trigger, Hydrator, Verifier, Authenticated, Responder
- Push serve coverage to 77.2%
- Fix 3 bugs + 22 new tests from cross-round analysis

## v0.5.10

- SSH worker support for remote execution
- Documentation updates for SSH workers
- Fix 3 critical + 6 high + 8 medium grill findings

## v0.5.9

- Rename `docs/` to `website/`
- Add CI/release workflows (Go cross-build, codesign, Homebrew)
- ISC license
- Landing page rewrite

## v0.5.8

- Security hardening: auth, containers, secrets, error handling
- Dispatch-policy-writeback pipeline tests

## v0.5.7

- **Policy noun**: result filtering before write-back
- `AllowAll`, `DenyAll`, `RuleFilter` implementations
- Integration tests for Policy
- Phase command with autonomous execution mode

## v0.5.6

- **Event noun**: GitHub webhooks + write-back pipeline
- Server, API reference, events & webhooks docs
- Split 7 over-limit files (200 LOC limit)

## v0.5.5

- Remove GitHub token blocklist (deferred to Phase 5)

## v0.5.4

- **Task noun**: `mecha serve` + SQLite persistence
- Full task dispatch pipeline
- 222 tests, serve 83%, worker 77%, task 86%

## v0.5.3

- Caddy reverse proxy + API key auth for worker containers
- Ollama adapter + example worker
- Plan Go adapter plugins for non-Docker LLM APIs

## v0.5.2

- Claude Agent SDK backend (replaces CLI wrapper)
- Go doc comments on all 44 exported symbols
- TDD Guardian WI-1 through WI-8
