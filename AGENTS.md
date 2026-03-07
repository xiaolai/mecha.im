# Project Instructions

> mecha.im is a local-first multi-agent runtime where each Mecha is a sandboxed bot (Claude Agent SDK App) process.

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
├── packages/              ← monorepo packages (core, cli, agent, service, etc.)
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

## Testing Environment

For multi-machine testing, deployment targets, SSH access, and runtime configuration, refer to `CLAUDE.local.md`.

## Known Limitations

### Security Trust Boundary
Secrets (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN) are passed as process environment variables.
Dashboard auth uses TOTP only (no API key login).
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

### bot Filesystem: Mirrors Real Claude Code

Each bot's directory structure mirrors the real `~/.claude/` layout:

```
alice/                              ← bot root (botDir = HOME)
├── .claude/
│   ├── settings.json               ← hooks config
│   ├── hooks/                      ← sandbox-guard.sh, bash-guard.sh
│   └── projects/
│       └── <workspace-path-encoded>/
│           ├── <session-id>.meta.json   ← session metadata
│           ├── <session-id>.jsonl       ← SDK transcript
│           └── <session-id>/            ← subagent data (future)
├── tmp/                            ← TMPDIR
├── logs/                           ← stdout.log, stderr.log
├── config.json                     ← port, token, workspace, spawn settings
└── state.json                      ← running/stopped/error state
```

**No SQLite.** Session storage is pure filesystem:
- `<session-id>.meta.json` — metadata (title, starred, createdAt, updatedAt)
- `<session-id>.jsonl` — SDK native transcript (user, assistant, progress, file-history-snapshot events)
- Path encoding: `/home/user/my.project` → `-home-alice-my-project` (same as Claude Code — `/`, `\`, `:`, and `.` are all replaced with `-`)

`config.json` includes core fields (port, token, workspace, model, tags, expose, sandboxMode, permissionMode, auth, meterOff, home) plus optional spawn settings for LLM behavior (systemPrompt, appendSystemPrompt, effort, maxBudget), tool control (allowedTools, disallowedTools, tools), agent identity (agent, addDir, budgetLimit), MCP/plugins (mcpConfig, strictMcpConfig, pluginDir), and session behavior (sessionPersistence, disableSlashCommands).

Environment variable `MECHA_PROJECTS_DIR` points to the workspace-specific projects directory.

### Spawn Settings Validation Rules
- `systemPrompt` and `appendSystemPrompt` are mutually exclusive — set one or the other, not both
- `allowedTools` and `tools` are mutually exclusive — use `allowedTools` for additive filtering or `tools` for a full override
- `bypassPermissions` requires `sandboxMode: "require"` — only sandboxed bots may bypass permission prompts

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **mecha.im** (1179 symbols, 2880 relationships, 82 execution flows).

GitNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/refactoring/SKILL.md` |

## Tools Reference

| Tool | What it gives you |
|------|-------------------|
| `query` | Process-grouped code intelligence — execution flows related to a concept |
| `context` | 360-degree symbol view — categorized refs, processes it participates in |
| `impact` | Symbol blast radius — what breaks at depth 1/2/3 with confidence |
| `detect_changes` | Git-diff impact — what do your current changes affect |
| `rename` | Multi-file coordinated rename with confidence-tagged edits |
| `cypher` | Raw graph queries (read `gitnexus://repo/{name}/schema` first) |
| `list_repos` | Discover indexed repos |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource | Content |
|----------|---------|
| `gitnexus://repo/{name}/context` | Stats, staleness check |
| `gitnexus://repo/{name}/clusters` | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members |
| `gitnexus://repo/{name}/processes` | All execution flows |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
