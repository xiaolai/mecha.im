# Claude Code History Storage

> How Claude Code stores conversation history on the filesystem.
>
> Date: 2026-02-23
> Based on: Claude Code v2.1.49–2.1.50

## Directory Structure

All conversation data lives under `~/.claude/projects/`. Each project gets a directory named by its absolute path with `/` replaced by `-`:

```
~/.claude/projects/
├── -home-alice-github-xiaolai-myprojects-mecha-im/   ← project dir
│   ├── <session-uuid>.jsonl          ← conversation transcript (one per session)
│   ├── <session-uuid>/              ← session artifacts directory
│   │   ├── subagents/               ← subagent transcripts
│   │   │   ├── agent-<hash>.jsonl
│   │   │   └── agent-acompact-<hash>.jsonl
│   │   └── tool-results/            ← large tool output spillover
│   │       └── <short-hash>.txt
│   ├── memory/                      ← persistent auto-memory
│   │   ├── MEMORY.md                ← always loaded into context
│   │   └── <topic>.md              ← topic-specific notes
│   └── sessions-index.json          ← session index (optional, not always present)
```

### Path Mapping Rule

The project directory name is the absolute project path with all `/` replaced by `-`:

| Project Path | Directory Name |
|---|---|
| `/home/user/projects/xiaolai/myprojects/mecha.im` | `-home-alice-github-xiaolai-myprojects-mecha-im` |
| `/home/mecha` (in container) | `-home-mecha` |
| `/home/user/ccspace` | `-home-alice-ccspace` |

## JSONL Transcript Files

Each session is stored as a single `.jsonl` file named by its session UUID. One JSON object per line. Lines are appended as the conversation progresses — the file is append-only during a session.

### Event Types

| Type | Count (typical) | Description |
|---|---|---|
| `progress` | Highest | Tool execution progress (hooks, bash, MCP, subagents) |
| `assistant` | High | Model responses with content, usage, model info |
| `user` | High | User messages with content, permissions, cwd |
| `file-history-snapshot` | Medium | File backup snapshots for undo/restore |
| `queue-operation` | Medium | SDK queue enqueue/dequeue events |
| `system` | Medium | System events (compaction, errors, commands) |

### User Message

```jsonc
{
  "type": "user",
  "parentUuid": "<previous-message-uuid>",    // null for first message
  "uuid": "<this-message-uuid>",
  "sessionId": "<session-uuid>",
  "timestamp": "2026-02-23T00:02:43.603Z",
  "cwd": "/home/user/projects/xiaolai/myprojects/mecha.im",
  "gitBranch": "main",
  "version": "2.1.49",                        // Claude Code version
  "userType": "external",
  "isSidechain": false,
  "permissionMode": "acceptEdits",             // user's permission mode
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "..." }]
    // or content can be a plain string
  }
}
```

### Assistant Message

```jsonc
{
  "type": "assistant",
  "parentUuid": "<user-message-uuid>",
  "uuid": "<this-message-uuid>",
  "sessionId": "<session-uuid>",
  "timestamp": "2026-02-23T00:02:45.000Z",
  "requestId": "req_011CYNn2GteWQgofFhx8UtDM",
  "message": {
    "model": "claude-sonnet-4-6",              // model used for this response
    "id": "msg_01HkXBEQjxe7WaAFgWs7YNMa",     // Anthropic message ID
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "..." },   // thinking blocks
      { "type": "text", "text": "..." },            // text response
      { "type": "tool_use", "id": "toolu_...", "name": "Read", "input": {...} }  // tool calls
    ],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "output_tokens": 42,
      "cache_creation_input_tokens": 2088,
      "cache_read_input_tokens": 13885,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 2088,
        "ephemeral_1h_input_tokens": 0
      },
      "service_tier": "standard",
      "inference_geo": "global"
    }
  }
}
```

### Progress Events

Track tool execution progress. Four subtypes:

| `data.type` | Description |
|---|---|
| `hook_progress` | Pre/post tool-use hook execution |
| `bash_progress` | Shell command output streaming |
| `mcp_progress` | MCP server tool call progress |
| `agent_progress` | Subagent (Task tool) execution |

```jsonc
{
  "type": "progress",
  "data": {
    "type": "hook_progress",
    "hookEvent": "PreToolUse",
    "hookName": "PreToolUse:Read",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"
  },
  "toolUseID": "toolu_01MEeFXmuPK7X7BWh5sk2n5Y",
  "parentToolUseID": "toolu_..."  // if nested
}
```

### System Events

Seven subtypes:

| Subtype | Description |
|---|---|
| `compact_boundary` | Conversation was compacted (auto or manual) |
| `microcompact_boundary` | Smaller compaction pass |
| `api_error` | API call failure |
| `local_command` | Local CLI command execution (e.g., /exit) |
| `turn_duration` | Turn timing metrics |
| `informational` | General system info |
| `stop_hook_summary` | Hook execution summary at stop |

```jsonc
// compact_boundary example
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 172735       // token count before compaction
  }
}
```

### Queue Operations

SDK internal queue management:

```jsonc
{ "type": "queue-operation", "operation": "enqueue", "timestamp": "...", "sessionId": "..." }
{ "type": "queue-operation", "operation": "dequeue", "timestamp": "...", "sessionId": "..." }
```

### File History Snapshots

Track file states for undo/restore:

```jsonc
{
  "type": "file-history-snapshot",
  "messageId": "<uuid>",
  "snapshot": {
    "messageId": "<uuid>",
    "trackedFileBackups": {
      "/path/to/file.ts": "<backup-content-or-ref>"
    },
    "timestamp": "2026-02-22T23:50:05.564Z"
  },
  "isSnapshotUpdate": false
}
```

## Conversation Tree Structure

Messages form a **tree** via `parentUuid` links, not a flat list. This enables:

- **Branching** — editing a message creates a new branch from the same parent
- **Sidechains** — `isSidechain: true` marks alternative branches
- **Compaction** — `logicalParentUuid` preserves logical ordering after compaction removes intermediate nodes

The root message has `parentUuid: null`.

## Session Artifact Directories

Each session MAY have a directory (same UUID as the JSONL file) containing:

### `subagents/`

Subagent (Task tool) transcripts as separate JSONL files:

```
subagents/
├── agent-a8a83e5a275315175.jsonl        ← full subagent transcript
└── agent-acompact-576164f7083f8f7e.jsonl ← compacted subagent transcript
```

### `tool-results/`

Large tool outputs that are too big to inline in the JSONL. Stored as plain text files with short hash filenames:

```
tool-results/
└── be65793.txt    ← e.g., a large git diff output
```

**Not every session has a directory.** Directories are only created when subagents run or tool results overflow. Out of 38 sessions in one project: all 38 had `subagents/`, 16 also had `tool-results/`.

## `sessions-index.json`

An **optional** index file that provides session metadata without parsing every JSONL file. Not always present — appears to be generated/maintained by certain Claude Code versions or features.

```jsonc
{
  "version": 1,
  "originalPath": "/home/user/projects/xiaolai/myprojects/vmark",
  "entries": [
    {
      "sessionId": "b662e7bc-580f-444c-b03c-637763515b93",
      "fullPath": "/home/user/.claude/projects/-...-vmark/b662e7bc-....jsonl",
      "fileMtime": 1769684964176,         // file modification time (epoch ms)
      "firstPrompt": "on windows, ...",   // first user message (truncated)
      "summary": "Windows Path & Menu Fixes for vmark",  // AI-generated summary
      "messageCount": 45,
      "created": "2026-01-25T00:25:01.743Z",
      "modified": "2026-01-25T00:50:38.337Z",
      "gitBranch": "main",
      "projectPath": "/home/user/projects/xiaolai/myprojects/vmark",
      "isSidechain": false
    }
  ]
}
```

Key fields:
- `summary` — AI-generated title for the session (what the session list UI shows)
- `firstPrompt` — first user message text
- `messageCount` — total messages in the conversation
- `fileMtime` — JSONL file modification timestamp (epoch ms)
- `isSidechain` — whether this is a sidechain/branch session

**Not all projects have this file.** In testing, projects with versions 2.1.30–2.1.42 had it, while 2.1.49+ did not. It may be a feature that was introduced and later removed, or generated lazily by the session list UI.

## `memory/` Directory

Persistent auto-memory that survives across sessions. Claude Code automatically reads `MEMORY.md` into context at the start of each conversation.

```
memory/
├── MEMORY.md          ← always loaded (first 200 lines)
├── debugging.md       ← topic-specific notes
└── patterns.md        ← linked from MEMORY.md
```

This is project-scoped. Each project has its own memory directory.

## Summary: Complete File Layout

```
~/.claude/projects/<project-slug>/
│
├── <uuid-1>.jsonl                    ← session 1 transcript
├── <uuid-1>/                         ← session 1 artifacts (optional)
│   ├── subagents/*.jsonl             ← subagent transcripts
│   └── tool-results/*.txt            ← large tool outputs
│
├── <uuid-2>.jsonl                    ← session 2 transcript
├── <uuid-2>/                         ← session 2 artifacts (optional)
│   └── subagents/*.jsonl
│
├── <uuid-N>.jsonl                    ← session N transcript
│
├── sessions-index.json               ← session index (optional)
│
└── memory/                           ← persistent auto-memory
    ├── MEMORY.md
    └── <topic>.md
```

## Cost & Usage Tracking

### Where cost data lives (and doesn't)

| Data Point | JSONL File | Agent SDK Stream | Toggle? |
|---|---|---|---|
| Per-message token counts | Yes (`assistant.message.usage`) | Yes | Always on |
| Per-message model name | Yes (`assistant.message.model`) | Yes | Always on |
| Cache token breakdown | Yes (`cache_creation_input_tokens`, `cache_read_input_tokens`) | Yes | Always on |
| `total_cost_usd` | **No** | Yes (`result` event) | Always on |
| `modelUsage` per-model breakdown | **No** | Yes (`result` event) | Always on |
| `duration_ms` / `num_turns` | **No** | Yes (`result` event) | Always on |

**There is no toggle.** Both the CLI and Agent SDK always emit usage data — it's built into the protocol. The difference is what gets *persisted*.

### JSONL: tokens only, no USD cost

Every assistant message in the JSONL file includes raw token counts:

```jsonc
"usage": {
  "input_tokens": 3,
  "output_tokens": 42,
  "cache_creation_input_tokens": 2088,
  "cache_read_input_tokens": 13885,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 2088,   // 5-minute cache tier
    "ephemeral_1h_input_tokens": 0       // 1-hour cache tier
  },
  "service_tier": "standard",
  "inference_geo": "global"              // or "not_available"
}
```

No USD cost is stored. To compute cost from JSONL files, multiply token counts by model pricing (the `model` field on each assistant message identifies which pricing to use).

### Agent SDK: full cost in `result` event

The SDK's `query()` streaming protocol emits a `result` event at the end of each conversation:

```typescript
// SDKResultMessage (from @anthropic-ai/claude-agent-sdk)
{
  type: "result",
  subtype: "success",              // or "error_max_turns", "error_during_execution", etc.
  session_id: string,
  total_cost_usd: number,         // authoritative total cost
  duration_ms: number,
  duration_api_ms: number,
  num_turns: number,
  usage: {
    input_tokens: number,
    output_tokens: number,
    cache_creation_input_tokens: number,
    cache_read_input_tokens: number,
  },
  modelUsage: {                    // per-model breakdown
    [modelName: string]: {
      inputTokens: number,
      outputTokens: number,
      cacheReadInputTokens: number,
      cacheCreationInputTokens: number,
      webSearchRequests: number,
      costUSD: number,             // cost for this model specifically
      contextWindow: number,
    }
  }
}
```

**This event is NOT written to the JSONL file.** It only exists in the streaming protocol. Any consumer that wants cost data must capture it from the stream in real-time.

### SDK usage rules

1. **Same message ID = same usage** — multiple assistant messages in one turn share the same `id` and identical `usage` values; charge only once per unique ID
2. **`result.total_cost_usd` is authoritative** — use this for billing, not per-message calculations
3. **`result.modelUsage` gives per-model costs** — essential when using multiple models (e.g., Haiku for subagents, Opus for main agent)

### Computing cost from JSONL (offline)

Since JSONL files don't store USD cost, offline analysis requires:

1. Parse each `assistant` message
2. Read `message.model` (e.g., `"claude-sonnet-4-6"`)
3. Read `message.usage.input_tokens`, `output_tokens`, `cache_*` fields
4. Apply model-specific pricing rates
5. Sum across all messages (deduplicate by `message.id`)

Community tools like [ccusage](https://github.com/ryoppippi/ccusage) automate this with bundled pricing data.

### CLI `/cost` command

During an interactive Claude Code session, `/cost` shows cumulative token usage and estimated cost for the current session. This data is computed in-memory and is **not persisted** to the JSONL file.

### Implications for the dashboard

Our runtime's `SessionManager` already captures `total_cost_usd` from SDK `result` events during `sendMessage()` and stores it in SQLite (`total_cost_usd` column). This is the only place where USD cost is persisted.

If we move to a filesystem-first architecture (reading JSONL directly), we lose pre-computed USD costs and would need to either:
- Compute cost from token counts + model pricing at read time
- Continue capturing `result` events during active sessions and storing cost in a sidecar file

## Key Observations

1. **JSONL is the source of truth** — every message, tool call, thinking block, and usage stat is in the JSONL file
2. **Append-only during session** — no rewrites, safe for concurrent reads
3. **Tree structure via parentUuid** — supports branching and sidechains
4. **Per-message model and usage** — each assistant response records which model was used and exact token counts
5. **sessions-index.json is optional** — can't rely on it existing; must be able to parse JSONL directly
6. **Session directories are optional** — only created for sessions with subagents or large tool results
7. **Memory is separate from sessions** — lives in `memory/` subdirectory, persists across all sessions
8. **No result events in JSONL** — usage is embedded in each `assistant` message's `usage` field, not as separate `result` events (the `result` event type comes from the Agent SDK streaming protocol, not the JSONL storage)
9. **No USD cost in JSONL** — only raw token counts; dollar amounts must be computed from token counts × model pricing, or captured from SDK `result` events during streaming
