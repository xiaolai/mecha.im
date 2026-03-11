# Session Management

## Design: Per-Task Sessions

Bots manage multiple conversation sessions (tasks). Each task is an independent conversation thread. The bot decides when to start a new task.

## How the SDK Works (ground truth)

The Agent SDK spawns the `claude` CLI binary as a child process. It writes session files to disk automatically:

```
~/.claude/projects/<encoded-cwd>/
├── <session-id>.jsonl          # transcript (one SDKMessage per line)
└── <session-id>.meta.json      # metadata: { id, title, starred, createdAt, updatedAt }
```

Where `<encoded-cwd>` encodes the `cwd` option (e.g., `/workspace` → `-workspace`).

**Session resume:** Pass `options.resume = "<session-id>"` to continue a previous session. Or `options.continue = true` to auto-find the most recent session in the cwd.

**Session IDs** are UUIDs, present on every streamed message. Capture from the `result` message:

```typescript
for await (const message of conversation) {
  if (message.type === "result") {
    sessionId = message.session_id;       // UUID — store this for resume
    cost = message.total_cost_usd;        // cost — SDK calculates this
    duration = message.duration_ms;
  }
}
```

## Our Layer: Task Metadata

We add a lightweight `index.json` on top of the SDK's native session management:

```
/state/sessions/index.json     # our task metadata
/home/appuser/.claude/         # SDK session state (transcripts, meta)
```

### index.json

```json
{
  "active": "task-abc",
  "tasks": [
    {
      "id": "task-abc",
      "session_id": "a1b2c3d4-...",
      "created": "2026-03-11T10:00:00Z",
      "status": "active",
      "summary": "Reviewing PR #42",
      "cost_usd": 0.045
    },
    {
      "id": "task-def",
      "session_id": "e5f6g7h8-...",
      "created": "2026-03-10T14:00:00Z",
      "status": "completed",
      "summary": "Daily summary for March 10",
      "cost_usd": 0.023
    }
  ]
}
```

The `session_id` field links our task to the SDK's session. This is how we resume.

## Session Lifecycle

1. **First prompt** → `query()` with no resume, SDK creates a new session. Capture `session_id` from result. Create task entry in index.json.
2. **Subsequent prompts** → `query()` with `resume: task.session_id`. SDK replays from transcript on disk.
3. **Bot calls `mecha_new_session`** → mark current task completed, next `query()` starts without resume (new SDK session).
4. **`?new_session=true` on `/prompt`** → same as above, triggered externally.
5. **Container restart** → read index.json, get active task's `session_id`, pass to `query()` as `resume`.

## Query Call Pattern

```typescript
const activeTask = getActiveTask();  // from index.json

const conversation = query({
  prompt: message,
  abortController: ac,
  options: {
    model: config.model,
    maxTurns: config.max_turns ?? 25,
    systemPrompt: config.system,
    cwd: "/workspace",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,  // required with bypassPermissions
    resume: activeTask?.session_id,         // resume if we have a session
    pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    mcpServers: { "mecha-tools": mechaToolServer },  // custom tools
  }
});

for await (const msg of conversation) {
  if (msg.type === "assistant") {
    // msg.message is a BetaMessage — extract text from content blocks
    for (const block of msg.message.content) {
      if (block.type === "text") emitSSE("text", { content: block.text });
    }
  }
  if (msg.type === "result") {
    // msg.total_cost_usd, msg.session_id, msg.duration_ms
    updateTask(activeTask.id, {
      session_id: msg.session_id,
      cost_usd: (activeTask.cost_usd ?? 0) + msg.total_cost_usd,
    });
  }
}
```

## Cost Tracking

The SDK provides `total_cost_usd` on every result message. We accumulate per-task, per-day, and lifetime:

```typescript
// From SDK result message — no manual token counting needed
const costThisQuery = result.total_cost_usd;
```

Stored in `costs.json`:

```json
{
  "lifetime": { "cost_usd": 1.32, "queries": 47, "first_started": "2026-03-01T09:00:00Z" },
  "days": {
    "2026-03-11": { "cost_usd": 0.21, "queries": 8 }
  }
}
```

## mecha_new_session

```
Tool: mecha_new_session
Parameters: { summary?: string }
Returns: { new_task_id, previous_task: { id, summary, status: "completed" } }
```

Action:
1. Mark current task as `completed`, write `summary`
2. Create new task entry with `status: "active"`, no `session_id` yet
3. Next `query()` call starts without `resume` → SDK creates new session
4. New `session_id` captured from result and stored

## How the Bot Decides

The bot's system prompt can include guidance:

```
When you finish reviewing a PR, start a new session for the next one.
```

Or the bot decides autonomously — the `mecha_new_session` tool is always available.

## Resilience

- Missing `index.json` → create default, first prompt starts new session
- Corrupt `index.json` → rebuild fresh, log warning
- SDK session file missing → SDK starts new session, no error
- All writes to index.json use atomic temp+rename

## Volume Mounts

```
<bot-path>/sessions/    → /state/sessions/         # index.json (our metadata)
<bot-path>/claude/      → /home/appuser/.claude/    # SDK state (transcripts)
```

Both mounted rw. Both survive container rebuilds.

## SDK Message Types (reference)

Key types from the stream:

| Type | Use |
|------|-----|
| `system` (subtype: `init`) | Session started, contains `session_id` |
| `assistant` | Model response with content blocks |
| `stream_event` | Partial streaming content (if `includePartialMessages: true`) |
| `tool_use_summary` | Tool invocation summary |
| `tool_progress` | Tool execution progress |
| `result` | Final result: `session_id`, `total_cost_usd`, `duration_ms`, `num_turns` |
