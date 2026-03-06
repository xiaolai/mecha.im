---
title: Sessions & Chat
description: Persistent conversation sessions stored as files on disk — resume, star, and manage agent threads.
---

# Sessions & Chat

Every conversation with a Mecha agent is a **session** — a persistent thread of messages stored as files on disk.

## Chatting

```bash
# Send a message and stream the response
mecha bot chat researcher "Summarize the latest papers in my workspace"
```

The response streams to your terminal via Server-Sent Events (SSE). You'll see the agent's thinking process and final response in real time.

## Session Management

```bash
# List all sessions for an agent
mecha bot sessions list researcher

# Show a specific session transcript
mecha bot sessions show researcher <session-id>
```

## Session Storage

Sessions are stored as plain files — no database:

```
~/.mecha/researcher/home/.claude/projects/-Users-you-papers/
├── abc123.meta.json     ← metadata
└── abc123.jsonl         ← transcript
```

### Metadata (`*.meta.json`)

```json
{
  "title": "Paper summarization",
  "starred": false,
  "createdAt": "2026-02-26T10:00:00Z",
  "updatedAt": "2026-02-26T10:05:00Z"
}
```

### Transcript (`*.jsonl`)

Each line is a JSON event — matching the Claude Agent SDK's native format:

```jsonl
{"type":"user","message":"Summarize the latest papers"}
{"type":"assistant","message":"I found 3 papers in your workspace..."}
{"type":"tool_use","name":"mecha_workspace_list","input":{}}
{"type":"tool_result","content":[{"type":"text","text":"paper1.pdf\npaper2.pdf"}]}
```

## MCP Tools

Each bot exposes workspace tools via the MCP (Model Context Protocol) at `POST /mcp` using JSON-RPC 2.0:

### Workspace Tools

| Tool | Description |
|------|-------------|
| `mecha_workspace_list` | List files in the workspace directory |
| `mecha_workspace_read` | Read a file from the workspace |

**`mecha_workspace_list`** accepts an optional `path` parameter (relative to workspace root). Returns a newline-separated list of entries, with directories suffixed by `/`.

**`mecha_workspace_read`** requires a `path` parameter. Returns the file content as text. Files larger than 10 MB are rejected. Path traversal outside the workspace boundary is blocked (symlinks are resolved and validated).

### Mesh Tools

Mesh tools are available only when `mechaDir` and `botName` are configured:

| Tool | Description |
|------|-------------|
| `mesh_query` | Send a message to another bot and get a response |
| `mesh_discover` | Find other bots by tag or capability |

**`mesh_query`** parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `string` | Yes | Target bot name or address (`name@node`) |
| `message` | `string` | Yes | Message to send |
| `sessionId` | `string` | No | Session ID for multi-turn conversations |

Returns the response text. If the target returns a `sessionId`, it is included in the `_meta` field for subsequent turns.

**`mesh_discover`** parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | `string` | No | Filter by tag |
| `capability` | `string` | No | Filter by exposed capability |

Returns a list of running bots matching the filter. Discovery reads from `~/.mecha/discovery.json` (the bot's own entry is excluded from results).

### MCP Protocol Details

The MCP endpoint implements three JSON-RPC methods:

| Method | Description |
|--------|-------------|
| `initialize` | Returns server info and capabilities (protocol version `2024-11-05`) |
| `tools/list` | Returns all available tools (workspace + mesh if configured) |
| `tools/call` | Execute a tool by name with arguments |

Error messages exposed to clients are filtered through a safe-prefix allowlist to avoid leaking filesystem paths.

## API Reference (`@mecha/runtime`)

### `createSessionManager(projectsDir): SessionManager`

Creates a filesystem-backed session manager that reads session files written by Claude Code (Agent SDK).

```ts
import { createSessionManager } from "@mecha/runtime";

const sm = createSessionManager(
  "/Users/you/.mecha/researcher/home/.claude/projects/-Users-you-workspace"
);

const sessions = sm.list();  // SessionMeta[]
const session = await sm.get("abc123");  // Session | undefined
const removed = sm.delete("abc123");  // boolean
```

**`SessionManager`**

| Method | Returns | Description |
|--------|---------|-------------|
| `list()` | `SessionMeta[]` | List all sessions, sorted by `updatedAt` descending |
| `get(id)` | `Promise<Session \| undefined>` | Get a session with its full transcript events |
| `delete(id)` | `boolean` | Delete a session's `.meta.json` and `.jsonl` files. Returns `true` if anything was removed |

Session IDs are validated against the pattern `^[a-zA-Z0-9_-]+$` to prevent path traversal.

### `SessionMeta`

```ts
interface SessionMeta {
  id: string;        // Session ID (slug)
  title: string;     // Human-readable title (or "(active session)" for .jsonl-only)
  starred: boolean;  // Whether the session is starred
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### `Session`

Extends `SessionMeta` with the full transcript:

```ts
interface Session extends SessionMeta {
  events: TranscriptEvent[];
}
```

### `TranscriptEvent`

```ts
interface TranscriptEvent {
  type: string;          // Event type (user, assistant, tool_use, tool_result, etc.)
  [key: string]: unknown; // Additional event-specific fields
}
```

### Session Discovery

The `list()` method performs a two-pass scan:

1. **Meta files** -- Reads all `*.meta.json` files for complete metadata.
2. **Orphan transcripts** -- For `.jsonl` files without a corresponding `.meta.json` (happens when Claude Code creates a transcript before writing metadata), synthetic metadata is generated with the title `"(active session)"` and timestamps from the file's `birthtime`/`mtime`.

Transcripts larger than `DEFAULTS.MAX_TRANSCRIPT_BYTES` are returned as empty event arrays to prevent memory exhaustion.
