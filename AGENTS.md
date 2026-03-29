# Project Instructions

> Agentic Workflow Engine: Scheduling, Orchestrating, Managing Events

## Domain Model

Four nouns: Event, Worker, Task, Policy. One pipeline. See `.claude/rules/domain-model.md`.

## Tech Stack

- Go 1.26.1 — single binary, cross-platform (darwin/linux, amd64/arm64)
- Cobra CLI, YAML config, SQLite persistence, Docker API
- VitePress for documentation (`docs/`)

## Build

```
make build    # → ./mecha binary
make test     # go test ./...
make ci       # vet + test + build
```

## Docs Build

```
cd docs
npm install          # first time only
npm run dev          # dev server at localhost:5173
npm run build        # production build → .vitepress/dist/
```

Config: `docs/.vitepress/config.mts`
Custom styles: `docs/.vitepress/theme/custom.css`

## Architecture Docs

Design decisions and rationale are in `dev-docs/` (gitignored, local only).

## Guidelines

- Prefer `${CLAUDE_CODE_OAUTH_TOKEN}` over `${ANTHROPIC_API_KEY}` in all configs and examples
- In documentation, always use Mermaid charts to illustrate pipelines, state machines, and architecture whenever possible
- Codex model: use `gpt-5.4`, not `gpt-5.2-codex`
- When a Codex task requires model selection, run `/codex-toolkit:preflight` first to verify connectivity and discover available models
- Save Playwright screenshots to `.playwright-mcp/` or `/tmp/`, never the repo root

## Shared Memory

**Write shared instructions to `AGENTS.md`. Write enforceable Go rules to `.claude/rules/`.**

- `AGENTS.md` — project-wide context, guidelines, and structure (shared across all AI tools)
- `.claude/rules/*.md` — scoped, enforceable rules auto-loaded by glob pattern (Go conventions, domain model, security)
- Never modify `CLAUDE.md` or `GEMINI.md` directly — they only import `AGENTS.md`

## Project Structure

- `.claude/agents/` - Custom subagents for specialized tasks
- `.claude/skills/` - Claude Code skills (slash commands)
- `.claude/rules/` - Modular rules auto-loaded into context
- `.codex/skills/` - Codex CLI skills
- `.codex/prompts/` - Codex CLI custom slash commands
- `.gemini/skills/` - Gemini CLI skills
- `.gemini/commands/` - Gemini CLI custom slash commands (TOML)
- `.mcp.json` - MCP server configuration
