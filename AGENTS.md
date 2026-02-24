# Project Instructions

> mecha.im is a local-first multi-agent runtime where each Mecha is a sandboxed CASA (Claude Agent SDK App) process.

## Guidelines

### CLI-First Development (Mandatory)

Every new feature follows this strict pipeline: **CLI → Test → GUI**

1. **CLI First** — Implement in `packages/cli/src/commands/` using `CommandDeps` DI pattern
2. **Test Next** — Write tests in `packages/cli/__tests__/`, meet coverage gates (100%)
3. **Verify Gates** — `pnpm test` + `pnpm test:coverage` + `pnpm typecheck` must all pass
4. **GUI Last** — Only then add dashboard/ui components as thin wrappers over shared logic

Use `/cli-first-dev` skill to guide implementation of any new feature.

Rules enforcing this pattern:
- `.claude/rules/cli-first.md` — Global enforcement on all TS/TSX files
- `.claude/rules/no-gui-without-cli.md` — Blocks GUI-only features in dashboard/ui

## Shared Memory

**Always write new instructions, rules, and memory to `AGENTS.md` only.**

Never modify `CLAUDE.md` or `GEMINI.md` directly - they only import `AGENTS.md`.
This ensures Claude Code, Codex CLI, and Gemini CLI share the same context consistently.

## Project Structure

```
mecha.im/
├── packages/              ← v2 source code (empty until Phase 0)
├── dev-docs/
│   ├── plan/              ← v2 phase plans (phase-0 through phase-7)
│   ├── research/          ← discovery, networking, naming research
│   ├── architecture.md    ← v2 architecture proposal
│   └── phases.md          ← v2 phase overview
├── v1/                    ← archived v1 code and docs (read-only reference)
│   ├── packages/          ← 10 v1 packages (cli, core, runtime, etc.)
│   ├── docs/              ← v1 specs and design notes
│   └── scripts/           ← v1 utility scripts
├── website/               ← landing page + branding assets
├── .claude/               ← Claude Code config
│   ├── agents/            ← custom subagents
│   ├── skills/            ← slash commands
│   └── rules/             ← modular rules auto-loaded into context
├── .codex/                ← Codex CLI config
├── .gemini/               ← Gemini CLI config
└── .mcp.json              ← MCP server configuration
```

## Known Limitations

### Security Trust Boundary
Secrets (ANTHROPIC_API_KEY, MECHA_OTP) are passed as process environment variables.
Anyone with access to `/proc/<pid>/environ` (root) can read them. This is acceptable for local-first usage.

### Port Assignment
Default port assignment scans the 7700-7799 range for an available port.
Use `--port` / request body `port` field for deterministic assignment.

### Quality Gates (Local Only)
All gates (`pnpm test`, `pnpm test:coverage`, `pnpm typecheck`, `pnpm build`) run locally.
No CI/CD pipeline is configured yet. Add GitHub Actions when merging to a shared repository.

### SSE Streaming: Client Disconnect Detection

**DO NOT use `req.raw.destroyed` or `req.raw.on("close")` to detect client disconnects in Fastify SSE handlers.**

`req.raw` (`IncomingMessage`) `destroyed` and `close` fire when the request body is consumed, NOT when the client disconnects. For POST endpoints this happens immediately after body parsing, breaking the SSE stream.

**Use `req.socket.on("close")` instead** — the socket only closes when the TCP connection drops.

### CASA Filesystem: Mirrors Real Claude Code

Each CASA's directory structure mirrors the real `~/.claude/` layout:

```
alice/                              ← CASA root (casaDir)
├── home/
│   └── .claude/
│       ├── settings.json           ← hooks config
│       ├── hooks/                  ← sandbox-guard.sh, bash-guard.sh
│       └── projects/
│           └── <workspace-path-encoded>/
│               ├── <session-id>.meta.json   ← session metadata
│               ├── <session-id>.jsonl       ← SDK transcript
│               └── <session-id>/            ← subagent data (future)
├── tmp/                            ← TMPDIR
├── logs/                           ← stdout.log, stderr.log
├── config.json                     ← port, token, workspace
└── state.json                      ← running/stopped/error state
```

**No SQLite.** Session storage is pure filesystem:
- `<session-id>.meta.json` — metadata (title, starred, createdAt, updatedAt)
- `<session-id>.jsonl` — SDK native transcript (user, assistant, progress, file-history-snapshot events)
- Path encoding: `/home/testuser/project` → `-home-alice-project` (same as Claude Code)

Environment variable `MECHA_PROJECTS_DIR` points to the workspace-specific projects directory.
