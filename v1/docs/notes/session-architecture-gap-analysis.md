# Session Architecture Gap Analysis

> Dashboard sessions vs CASA filesystem JSONL — findings and recommendations.
>
> Date: 2026-02-23

## Background

The dashboard manages chat sessions through a runtime `SessionManager` that maintains an in-process SQLite database. Meanwhile, CASA (Claude Agent SDK App) writes its own session history as JSONL files at `$HOME/.claude/projects/-home-mecha/` inside the container, which is accessible on the host via the bind mount at `<mecha-path>/.claude/projects/-home-mecha/`.

This analysis compares the two data sources and identifies architectural gaps.

## Data Model Comparison

| | **Filesystem (JSONL)** | **Runtime (SQLite)** |
|---|---|---|
| Location | `<project-path>/.claude/projects/-home-mecha/*.jsonl` | In-memory SQLite inside the runtime process |
| Session ID | SDK-generated UUID (filename) | Runtime-generated UUID; maps via `sdk_session_id` column |
| Source of truth | Yes — written by Claude Agent SDK | No — derived copy of JSONL data |
| Accessible when stopped | Yes — host filesystem | No — requires running container |

## What JSONL Files Contain

Each JSONL file is a complete conversation transcript with one JSON object per line:

1. **Full conversation tree** — `parentUuid` links form a tree structure, enabling branch navigation
2. **Per-message metadata** — `uuid`, `timestamp`, `cwd`, `gitBranch`, `version`, `sessionId`
3. **Thinking blocks** — assistant `content` includes `type: "thinking"` blocks
4. **Token-level usage** — per-message `usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `inference_geo`, `service_tier`
5. **Model per message** — each assistant message records `model: "claude-sonnet-4-6"`
6. **Permission mode** — captured on each user message
7. **Queue operations** — `enqueue`/`dequeue` events showing when messages were queued
8. **File history snapshots** — `type: "file-history-snapshot"` with tracked file backups

### JSONL Entry Types

| Type | Description |
|---|---|
| `queue-operation` | SDK queue enqueue/dequeue events |
| `user` | User messages with `role`, `content`, `permissionMode`, `cwd` |
| `assistant` | Assistant responses with `model`, `usage`, `content` (text + thinking blocks) |
| `file-history-snapshot` | File backup snapshots for undo/restore |

### JSONL Message Structure

```jsonc
// User message
{
  "type": "user",
  "parentUuid": "previous-msg-uuid",
  "uuid": "this-msg-uuid",
  "sessionId": "sdk-session-id",
  "timestamp": "2026-02-23T00:02:43.603Z",
  "cwd": "/home/mecha",
  "gitBranch": "HEAD",
  "version": "2.1.49",
  "permissionMode": "acceptEdits",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "..." }]
  }
}

// Assistant message
{
  "type": "assistant",
  "parentUuid": "user-msg-uuid",
  "uuid": "this-msg-uuid",
  "sessionId": "sdk-session-id",
  "timestamp": "2026-02-23T00:02:45.000Z",
  "message": {
    "model": "claude-sonnet-4-6",
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "..." }
    ],
    "usage": {
      "input_tokens": 3,
      "output_tokens": 42,
      "cache_creation_input_tokens": 2088,
      "cache_read_input_tokens": 13885
    }
  }
}
```

## What the Runtime Stores (not in JSONL)

1. **Session title** — extracted from first user message during import (50 char truncation), editable via rename
2. **Session state** — `idle`/`busy` (ephemeral, only meaningful while running)
3. **Session config** — `model`, `maxTurns`, `systemPrompt`, `permissionMode` overrides
4. **Aggregated usage** — `total_cost_usd`, `total_input_tokens`, etc. (summed from SDK `result` events)

## Identified Gaps

### 1. Dual ID System

The runtime creates its own UUID per session, then maintains a `sdk_session_id` column to map to the SDK's UUID (which is the JSONL filename). This adds complexity for no value — the SDK UUID is the canonical identifier and could be used directly.

### 2. Messages Stored Twice (Lossy)

The `session_messages` table duplicates conversation content that's already in JSONL files, but with significantly less information:

| Feature | JSONL | SQLite `session_messages` |
|---|---|---|
| Text content | Yes | Yes |
| Thinking blocks | Yes | No |
| Tool use/results | Yes | No |
| Per-message usage | Yes | No |
| Branch structure | Yes (parentUuid) | No |
| Model per message | Yes | No |
| File history | Yes | No |

### 3. Import is Lossy

`SessionManager.importTranscripts()` reads JSONL files and extracts text-only content into SQLite. The dashboard shows a flattened, impoverished version of conversations — no thinking, no tool calls, no branches.

### 4. Runtime Must Be Running for Reads

The dashboard fetches sessions from the runtime API (`GET /api/mechas/:id/sessions`). But JSONL files are on the host filesystem via bind mount and readable without the container running. The CLI already knows the mount path.

### 5. No Real-Time Sync

If someone uses `claude` CLI inside the container directly (via SSH or terminal), new sessions appear as JSONL files but the runtime's SQLite doesn't know about them until `importTranscripts` is explicitly called.

### 6. State Split Across Three Stores

- **Starred sessions** — dashboard client-side zustand store
- **Session titles** — runtime SQLite
- **Conversation data** — JSONL files inside container

Three different storage layers for one conceptual entity.

## Recommendation: Filesystem-First Architecture

### Principle

Use JSONL files as the single source of truth. The runtime is only needed for active operations (send, interrupt, config). All read operations should go through the filesystem.

### Proposed Changes

1. **List sessions** — Scan `<mecha-path>/.claude/projects/-home-mecha/*.jsonl` on the host filesystem. No runtime needed.

2. **Read conversation history** — Parse JSONL directly, preserving thinking blocks, tool use, branches, and per-message usage. Richer than current SQLite copy.

3. **Use SDK session ID everywhere** — Drop the dual-ID system. The JSONL filename UUID is the session ID.

4. **Active operations via runtime** — `sendMessage` (calls `query()`), `interrupt` (aborts stream), `updateConfig` still go through the runtime API.

5. **Dashboard-only metadata** — Stars, custom titles, and UI preferences stored in a lightweight local file (JSON) alongside the JSONL directory, or in the dashboard's client-side store.

### Benefits

- Sessions visible even when container is stopped
- Full conversation fidelity (thinking, tool use, branches)
- No import step needed
- Single ID namespace
- Simpler architecture (no SQLite session cache)
- CLI and dashboard read the same data the same way

### What the Runtime Still Owns

- Creating new SDK sessions (`query()` with no `resume`)
- Resuming sessions (`query()` with `resume: sdkSessionId`)
- Streaming responses back to the dashboard
- Interrupting active sessions
- Session config (model, maxTurns, systemPrompt, permissionMode)
- Tracking `busy`/`idle` state for active sessions only
