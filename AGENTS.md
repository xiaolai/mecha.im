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

- `.claude/agents/` - Custom subagents for specialized tasks
- `.claude/skills/` - Claude Code skills (slash commands)
- `.claude/rules/` - Modular rules auto-loaded into context
- `.codex/skills/` - Codex CLI skills
- `.codex/prompts/` - Codex CLI custom slash commands
- `.gemini/skills/` - Gemini CLI skills
- `.gemini/commands/` - Gemini CLI custom slash commands (TOML)
- `.mcp.json` - MCP server configuration

## Known Limitations

### Dashboard Sessions
Dashboard stores sessions in-memory (`packages/dashboard/src/lib/auth.ts`).
This is single-process only. If multi-instance deployment is needed, replace with signed JWT or Redis sessions.

### Security Trust Boundary
Secrets (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, MECHA_OTP) are passed as process environment variables.
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

### API Contract

The dashboard API (`/api/mechas`) returns a `ports` array for backward compatibility with the frontend:
```
GET /api/mechas → [{ id, name, state, status, path, ports: [{ PublicPort, PrivatePort, Type }], created }]
POST /api/mechas → { id, name, port, authToken } (body: { path, env?, claudeToken?, otp?, permissionMode? })
```
The service layer (`mechaLs`) returns `port` (number). The dashboard route maps this to the `ports` array shape.
