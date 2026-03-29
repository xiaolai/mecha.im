---
description: Worker YAML specification — CLI-backed workers (claude, codex, gemini) and their config
globs: ["**/*.go", "workers/**/*.yml"]
---

# Worker YAML Specification

## Structure Detection

No `type` field. The YAML structure determines the worker kind:

| Section present | Worker kind | Start behavior |
|---|---|---|
| `claude:` | Claude Code CLI worker | Exec `claude` per task |
| `codex:` | Codex CLI worker | Exec `codex` per task |
| `gemini:` | Gemini CLI worker | Exec `gemini` per task |
| `docker:` | Managed container | Docker API lifecycle |
| (none of above) | External endpoint | Mark online, probe health |

## Common Fields

```yaml
name: worker-name              # required, unique
endpoint: http://host:port     # listen address (CLI workers auto-assign if omitted)
timeout: 30m                   # task timeout (default: 10m)
```

## Claude Worker

```yaml
name: reviewer
claude:
  model: claude-sonnet-4-6
  cwd: /path/to/project
  systemPrompt: "You review PRs for security issues."
  allowedTools: [Read, Grep, Glob, Bash]
  disallowedTools: [Write, Edit]
  permissionMode: plan           # default | plan | auto | bypassPermissions
  effort: high                   # low | medium | high | max
  settingSources: [user, project]
  mcpServers:
    github:
      command: gh
      args: [mcp]
  outputFormat: text             # text | json | stream-json
  maxBudgetUsd: 5.00             # spending cap (--print mode only)
  token: claude.xiaolaidev       # resolved from ~/.mecha/secrets.yml
timeout: 30m
```

### Claude Auth Resolution Order

1. `claude.token` → resolved from `~/.mecha/secrets.yml`, auto-detects type by prefix:
   - `sk-ant-oat01-...` → sets `CLAUDE_CODE_OAUTH_TOKEN` (subscription)
   - `sk-ant-api03-...` → sets `ANTHROPIC_API_KEY` (Console API)
2. Fall through to host default (`~/.claude/.credentials.json` or Keychain)

### Claude CLI Flag Mapping

| YAML field | CLI flag |
|---|---|
| `model` | `--model` |
| `cwd` | run from this directory |
| `systemPrompt` | `--system-prompt` |
| `allowedTools` | `--allowed-tools` |
| `disallowedTools` | `--disallowed-tools` |
| `permissionMode` | `--permission-mode` |
| `effort` | `--effort` |
| `outputFormat` | `--output-format` |
| `maxBudgetUsd` | `--max-budget-usd` |

Exec pattern: `claude --print --model X --output-format json --effort high "prompt"`
When `outputFormat` is `stream-json`, omit `--print`.

Note: `--max-turns` does not exist in Claude CLI. Use `maxBudgetUsd` for limits.

## Codex Worker

```yaml
name: coder
codex:
  model: gpt-5.4
  cwd: /path/to/project
  sandbox: workspace-write       # read-only | workspace-write | danger-full-access
  approvalPolicy: never          # untrusted | on-request | never
  effort: high                   # minimal | low | medium | high | xhigh
  token: codex.default           # resolved from ~/.mecha/secrets.yml
timeout: 30m
```

### Codex Auth Resolution Order

1. `codex.token` → resolved from `~/.mecha/secrets.yml`, sets `OPENAI_API_KEY`
2. Fall through to host default (`~/.codex/auth.json`)

### Codex CLI Flag Mapping

| YAML field | CLI flag |
|---|---|
| `model` | `--model` / `-m` |
| `cwd` | run from this directory |
| `sandbox` | `--sandbox` / `-s` |
| `approvalPolicy` | `--ask-for-approval` / `-a` |
| `effort` | config override: `-c model_reasoning_effort='"high"'` |

Exec pattern: `codex exec --model X --sandbox Y -a never "prompt"`

Note: `--quiet` does not exist in current Codex CLI (Rust rewrite). Use `codex exec` for non-interactive mode. Effort is config-only, not a CLI flag.

## Gemini Worker

```yaml
name: analyst
gemini:
  model: gemini-2.5-pro
  cwd: /path/to/project
  sandbox: true                  # boolean, or: docker | podman | sandbox-exec
  approvalMode: plan             # default | auto_edit | yolo | plan
  outputFormat: text             # text | json | stream-json
  token: gemini.default          # resolved from ~/.mecha/secrets.yml
timeout: 30m
```

### Gemini Auth Resolution Order

1. `gemini.token` → resolved from `~/.mecha/secrets.yml`, sets `GEMINI_API_KEY`
2. Fall through to host default (`~/.gemini/oauth_creds.json`)

Note: Gemini CLI has no config dir override env var. For multi-account, use API keys.

### Gemini CLI Flag Mapping

| YAML field | CLI flag |
|---|---|
| `model` | `--model` / `-m` |
| `cwd` | run from this directory (no `--cwd` flag) |
| `sandbox` | `--sandbox` / `-s` |
| `approvalMode` | `--approval-mode` |
| `outputFormat` | `--output-format` / `-o` |

Exec pattern: `gemini --model X --sandbox --approval-mode plan -p "prompt"`

Note: Gemini uses `-p` for non-interactive prompt (not `--print`). No `--cwd` flag — change directory before exec.

## Model Discovery

Model names change over time. Never hardcode model lists.

Discovery method depends on auth type:

| Backend | Auth type | Discovery method |
|---|---|---|
| Claude | API key (`sk-ant-api03-`) | `GET api.anthropic.com/v1/models` with `X-Api-Key` |
| Claude | Subscription (`sk-ant-oat01-`) | REST API not available; parse CLI output |
| Codex | Any | Via Codex MCP server (like `/codex-toolkit:preflight`) |
| Gemini | API key (`AIza...`) | `GET generativelanguage.googleapis.com/v1beta/models?key=KEY` |
| Gemini | OAuth | REST API needs API key; re-auth or parse CLI output |

`mecha serve` refreshes the model cache on startup and every 24h.
`mecha worker add` validates the model field against the cache and
suggests corrections if invalid. No separate command needed.

Cache: `~/.mecha/models.json` — written by mecha, human-readable.
Script: `scripts/refresh-models.sh` — discovery logic, called by mecha internally.

See `.claude/rules/secrets.md` for `~/.mecha/secrets.yml` format, token types, and resolution details.
