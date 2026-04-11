---
title: Dual-Agent Workers
description: Run Claude and Codex together in a single worker for cross-model collaboration.
---

# Dual-Agent Workers

Mecha supports running Claude and Codex together in a single Docker container. Claude acts as the primary agent, with Codex available as an MCP tool for second opinions, web search, and alternative implementations.

::: tip
Add `codex` to `docker.credentials` to enable. The Claude backend auto-detects `~/.codex/auth.json` in the container and spawns `codex mcp-server` as a stdio child process. API key users can set `CODEX_API_KEY` in `docker.env` instead — auto-detection kicks in when either credential file or API key is present.
:::

## Why Two Models?

Different LLMs have different strengths. Running both in one worker lets you combine them:

| Use case | Claude does | Codex does |
|---|---|---|
| **Cross-model review** | Reviews code, synthesizes findings | Reviews same code independently |
| **Research + implement** | Implements based on findings | Web search for current docs |
| **Second opinion** | Makes architectural decisions | Validates or challenges them |
| **Multi-turn collaboration** | Drives the task | Answers follow-up questions |

## How It Works

Claude runs as the primary agent via the Agent SDK. Codex runs as an MCP server (child process) inside the same container. Claude can call Codex tools whenever it needs to.

```mermaid
flowchart LR
    subgraph Container["mecha-worker"]
        direction TB
        HTTP["HTTP Server\nPOST /task"]
        SDK["Claude Agent SDK"]
        MCP["Codex MCP Server\nstdio child process"]
        HTTP --> SDK
        SDK -.->|"MCP tools"| MCP
    end
    A["Anthropic API"] <--> SDK
    O["OpenAI API"] <--> MCP
```

No special networking — the MCP server communicates over stdin/stdout of a child process. Both APIs are called outbound over HTTPS.

## Available MCP Tools

When Codex MCP is enabled, Claude gets access to these tools:

| Tool | What it does |
|---|---|
| `mcp__codex__codex` | Start a new Codex session with a prompt |
| `mcp__codex__codex-reply` | Continue an existing Codex session (multi-turn) |
| `mcp__codex__websearch` | Search the web via Codex |

The system prompt tells Claude when and how to use them.

## Worker Configuration

```yaml
name: claude-with-codex
docker:
  image: mecha-worker:latest
  credentials: [claude, codex]           # mount both CLI credentials
  cwd: /path/to/project
  resources:
    cpu: 4
    memory: 8G
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_EFFORT: high
    CLAUDE_SYSTEM_PROMPT: |
      You are a code review agent. Use your built-in tools for file access.
      When you need a second opinion or web search, use the Codex MCP tools.
timeout: 30m
```

## Authentication

Both models need their own credentials:

| Model | Auth method (preferred) | How |
|---|---|---|
| Claude | Subscription | `credentials: [claude]` (mounts `~/.claude/`) |
| Codex | Subscription | `credentials: [codex]` (mounts `~/.codex/`) |

The backend auto-detects `~/.codex/auth.json` when credentials are mounted — no extra env vars needed.

```yaml
docker:
  credentials: [claude, codex]    # both subscription credentials
```

For API key users (no subscription), set `CODEX_API_KEY` in `docker.env` — the backend auto-enables Codex MCP when an API key is detected.

## Request Flow

```mermaid
sequenceDiagram
    participant M as Mecha
    participant W as Worker
    participant C as Claude
    participant X as Codex
    participant A as Anthropic API
    participant O as OpenAI API

    M->>W: POST /task
    W->>C: query(prompt)
    C->>A: Request
    A-->>C: Use codex tool
    C->>X: codex {prompt}
    X->>O: Request
    O-->>X: Result
    X-->>C: {threadId, content}
    C->>A: Continue with result
    A-->>C: Final answer
    C-->>W: TaskResponse
    W-->>M: 200 OK
```

Claude decides when to consult Codex. It might never call Codex if the task is straightforward, or it might have a multi-turn conversation using `codex-reply`.

## Example: Cross-Model Code Review

```yaml
name: dual-reviewer
docker:
  image: mecha-worker:latest
  credentials: [claude, codex]
  cwd: /path/to/project
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_SYSTEM_PROMPT: |
      Review the PR diff for bugs, security issues, and code quality.
      After your review, use the Codex tool to get an independent review
      of the same diff. Compare both reviews and produce a unified report
      noting where you agree and where you differ.
events:
  - source: github
    on: [pull_request.opened, pull_request.synchronize]
    prompt: "Review this PR:\n\n{{.diff}}"
policy:
  comment: { allow: true, max_length: 4000 }
  labels: { allow: true }
timeout: 30m
```

## Compared to Separate Workers

You could achieve similar results with two separate workers (one Claude, one Codex) and a policy that combines their outputs. The dual-agent approach is simpler when:

- You want Claude to **decide** when to consult Codex (not always)
- You want **multi-turn** back-and-forth between models
- You want a **single output** that synthesizes both perspectives
- You want to minimize latency (no inter-container HTTP calls)

Use separate workers when:

- Each model should produce **independent** outputs
- You want **parallel** execution (both start simultaneously)
- You need different **policies** per model
- You want to **compare** raw outputs without synthesis

## Environment Variables

| Env var | Purpose | Default |
|---|---|---|
| `CODEX_MCP` | Force-enable Codex MCP (not needed if `~/.codex/auth.json` is mounted) | auto-detected |
| `CODEX_API_KEY` | Codex API key for non-subscription users | — |

All standard [Claude env vars](/guide/workers#backend-specific-env-vars) are also supported.
