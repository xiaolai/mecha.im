# Inter-Bot Communication System — Design Spec

> A2A-inspired task protocol + KV store + context handoff for mecha.im

## Goal

Fill all 8 identified communication gaps so bots can coordinate efficiently: push notifications, streaming progress, shared state, structured messages, broadcast queries, context handoff, event-driven workflows, and priority routing.

## Architecture

The design adds 4 subsystems to mecha, each addressing specific gaps:

1. **Task Protocol** — A2A-inspired task lifecycle with SSE streaming (gaps #1 push, #2 streaming, #4 schemas)
2. **Bus KV Store** — Key-value store backed by the existing bus package (gap #3 shared state)
3. **Broadcast & Discovery** — Fan-out queries and service registry (gap #5 broadcast)
4. **Context Handoff** — Summary + recent messages transfer on delegation (gap #6 context sharing)

Gaps #7 (event-driven workflows) and #8 (priority routing) are addressed as extensions to existing packages rather than new subsystems.

## Research Foundation

| Pattern | Source | What we adopt |
|---------|--------|--------------|
| Task lifecycle (pending→working→done) with SSE | Google A2A protocol | Task states, streaming events, webhook push |
| Actor mailbox with pub/sub topics | AutoGen v0.4 / Erlang | Bus topics for event fan-out |
| Shared state reduces tokens by 80% | AutoGen research | Bus KV store for coordination |
| Conversation handoff with input_filter | OpenAI Agents SDK | Summary + last N messages |
| Structured output validation | CrewAI Pydantic / A2A JSON Schema | Optional schema on tasks |
| Event-driven flows with conditional branching | CrewAI Flows | Workflow event gates |
| Priority mailbox | Akka | Priority field on queue messages |

---

## Subsystem 1: Task Protocol

### Concept

Every bot-to-bot interaction that may take more than a few seconds becomes a **Task** with a lifecycle. This replaces the blocking `mesh_query` pattern for long-running work.

### Task States

```
pending → working → completed
                  → failed
                  → cancelled
         → rejected (bot refuses the task)
```

### Data Model

```typescript
interface Task {
  id: string;               // UUID
  source: string;           // "bot@node" that created the task
  target: string;           // bot name that executes it
  status: TaskStatus;
  message: string;          // initial prompt/instruction
  inputSchema?: object;     // optional JSON Schema for input validation
  outputSchema?: object;    // optional JSON Schema for output validation
  result?: unknown;         // final output (when completed)
  error?: string;           // error message (when failed)
  createdAt: string;        // ISO 8601
  updatedAt: string;
  artifacts: TaskArtifact[];  // intermediate outputs
}

interface TaskArtifact {
  type: string;            // "text", "file", "json"
  data: unknown;
  createdAt: string;
}

type TaskStatus = "pending" | "working" | "completed" | "failed" | "cancelled" | "rejected";

interface TaskStatusUpdate {
  taskId: string;
  status: TaskStatus;
  message?: string;        // progress description
  timestamp: string;
}
```

### Agent Server Routes (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/tasks` | Required | Create a task for a local bot |
| `GET` | `/tasks/:id` | Required | Get task state |
| `GET` | `/tasks/:id/stream` | Required | SSE stream of task updates |
| `POST` | `/tasks/:id/cancel` | Required | Cancel a task |
| `GET` | `/tasks` | Required | List tasks (filtered by bot, status) |

### SSE Event Stream

```
event: status
data: {"taskId":"abc","status":"working","message":"Analyzing codebase...","timestamp":"..."}

event: artifact
data: {"taskId":"abc","type":"text","data":"Found 3 issues so far","timestamp":"..."}

event: status
data: {"taskId":"abc","status":"completed","timestamp":"..."}
```

### Webhook Push (async fallback)

For cross-node tasks where SSE is impractical, the task creator can provide a `webhookUrl`. The agent server POSTs status updates to this URL.

```typescript
interface TaskCreateRequest {
  bot: string;
  message: string;
  inputSchema?: object;
  outputSchema?: object;
  webhookUrl?: string;     // optional callback for async push
  priority?: "high" | "normal" | "low";
}
```

### MCP Tools (new)

| Tool | Description |
|------|-------------|
| `task_create(target, message, opts?)` | Create a task on another bot. Returns taskId |
| `task_status(taskId)` | Check task state and get result |
| `task_cancel(taskId)` | Cancel a running task |
| `task_list(bot?, status?)` | List tasks with optional filters |

### Backward Compatibility

`mesh_query` stays unchanged for quick synchronous Q&A. The task protocol is for work that benefits from progress tracking, streaming, or async completion.

### Storage

Tasks are stored as JSON files: `~/.mecha/tasks/<taskId>.json`. Completed tasks are auto-cleaned after 7 days.

---

## Subsystem 2: Bus KV Store

### Concept

A key-value store built on top of the existing bus package. Bots read/write shared state without message passing. Backed by JSONL like everything else.

### API

```typescript
interface KVStore {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, opts?: { ttl?: number }): void;
  delete(key: string): boolean;
  list(prefix?: string): Array<{ key: string; value: unknown; updatedAt: string }>;
  watch(prefix: string, callback: (key: string, value: unknown) => void): () => void;
}
```

### Storage

`~/.mecha/bus/kv/` directory with one JSONL file per namespace:

```
~/.mecha/bus/kv/
├── default.jsonl        # default namespace
├── workflow-abc.jsonl   # per-workflow namespace
└── team-dev.jsonl       # per-team namespace
```

Each entry: `{"key":"status","value":"ready","updatedAt":"...","ttl":3600}`

### MCP Tools (new)

| Tool | Description |
|------|-------------|
| `bus_kv_set(key, value, namespace?, ttl?)` | Set a key-value pair |
| `bus_kv_get(key, namespace?)` | Get a value by key |
| `bus_kv_delete(key, namespace?)` | Delete a key |
| `bus_kv_list(prefix?, namespace?)` | List keys matching prefix |

### Watch Mechanism

The `watch` function polls for changes (1-second interval by default). For MCP, a `bus_kv_watch` tool could return new/changed keys since the last check.

---

## Subsystem 3: Broadcast & Discovery

### Concept

Fan-out a query to multiple bots in parallel and collect responses. Built on existing `mesh_discover` + `mesh_query`.

### MCP Tools (new)

| Tool | Description |
|------|-------------|
| `mesh_broadcast(tag, message, opts?)` | Query all bots matching tag in parallel, collect responses |
| `mesh_discover_detailed(filter?)` | Enhanced discovery with capability, tag, status, and node info |

### `mesh_broadcast` Behavior

1. Call `mesh_discover(tag)` to find matching bots
2. Send `mesh_query` to each in parallel (with configurable concurrency limit)
3. Collect responses with timeout (default: 30s)
4. Return array of `{ bot, response?, error? }`

```typescript
interface BroadcastResult {
  bot: string;
  node?: string;
  response?: string;
  sessionId?: string;
  error?: string;
  durationMs: number;
}
```

### Options

```typescript
interface BroadcastOpts {
  tag?: string;           // filter by tag
  capability?: string;    // filter by capability
  concurrency?: number;   // max parallel queries (default: 5)
  timeoutMs?: number;     // per-query timeout (default: 30000)
  excludeSelf?: boolean;  // don't query the calling bot (default: true)
}
```

---

## Subsystem 4: Context Handoff

### Concept

When bot A delegates work to bot B, it can hand off a context summary + recent messages so bot B doesn't start cold.

### Mechanism

1. Bot A calls `context_handoff(target, contextOpts)` MCP tool
2. The tool reads bot A's recent session messages (last N configurable, default 10)
3. Generates a summary prefix: `"[Handoff from {botA}] Context: {summary}\n\nRecent conversation:\n{last N messages}"`
4. Creates a task on bot B with this context prepended to the message

### MCP Tool

| Tool | Description |
|------|-------------|
| `context_handoff(target, message, opts?)` | Delegate to another bot with conversation context |

### Options

```typescript
interface HandoffOpts {
  lastMessages?: number;    // number of recent messages to include (default: 10)
  summary?: string;         // explicit summary (if omitted, auto-generated from session)
  sessionId?: string;       // source session to extract context from
  createTask?: boolean;     // use task protocol instead of mesh_query (default: true)
}
```

### Integration

Handoff builds on top of both the task protocol (for the actual delegation) and the session storage (for reading conversation history). The handoff MCP tool:

1. Reads from `~/.mecha/<botA>/.claude/projects/<workspace>/<sessionId>.jsonl`
2. Extracts the last N user/assistant message pairs
3. Prepends as context in the task creation message

---

## Extension: Event-Driven Workflow Gates (gap #7)

Add new gate types to the existing workflow engine:

```typescript
interface StepDef {
  // ... existing fields
  gate?: "human" | EventGate;
}

interface EventGate {
  type: "topic" | "kv" | "webhook";
  // For topic: wait until a message matching filter appears
  topic?: string;
  filter?: string;
  // For kv: wait until a key has a specific value
  key?: string;
  value?: unknown;
  namespace?: string;
  // For webhook: wait until POST received at a generated URL
  path?: string;
}
```

The workflow engine's `executeReady` loop checks event gates alongside human gates. If a topic gate is set, it polls the topic for matching messages. If a KV gate is set, it checks the key's current value.

---

## Extension: Priority Queues (gap #8)

Add a `priority` field to `BusMessage`:

```typescript
interface BusMessage {
  id: string;
  ts: string;
  sender: string;
  payload: unknown;
  priority?: "high" | "normal" | "low";  // NEW — default: "normal"
}
```

`DurableQueue.claim()` returns the highest-priority pending message first (high > normal > low). Within the same priority, FIFO order is preserved.

Implementation: `claim()` scans pending messages and returns the first `high`, or first `normal` if no `high`, or first `low` if neither. This is O(n) but acceptable for queue sizes in the hundreds.

---

## Package Changes

| Package | Changes |
|---------|---------|
| `@mecha/agent` | Add `/tasks` routes, task storage, SSE streaming |
| `@mecha/bus` | Add `createKVStore()`, priority field on BusMessage, priority-aware `claim()` |
| `@mecha/runtime` | Add MCP tools: `task_*`, `bus_kv_*`, `mesh_broadcast`, `context_handoff` |
| `@mecha/workflow` | Add event gate types (topic, kv, webhook) |
| `@mecha/core` | Add `TaskStatus` types, task storage utilities |
| `@mecha/cli` | Add `mecha task list/show/cancel` commands |
| `@mecha/service` | Add `taskCreate`, `taskList`, `taskCancel` service functions |

### New Files (estimated)

```
packages/core/src/task-types.ts          — Task, TaskStatus, TaskArtifact types
packages/core/src/task-storage.ts        — read/write/list/clean task JSON files
packages/agent/src/task-routes.ts        — Fastify routes for /tasks
packages/agent/src/task-sse.ts           — SSE streaming for task updates
packages/bus/src/kv-store.ts             — KV store implementation
packages/runtime/src/mcp/task-tools.ts   — task_create, task_status, etc.
packages/runtime/src/mcp/kv-tools.ts     — bus_kv_set, bus_kv_get, etc.
packages/runtime/src/mcp/broadcast.ts    — mesh_broadcast implementation
packages/runtime/src/mcp/handoff.ts      — context_handoff implementation
packages/workflow/src/event-gate.ts      — event gate evaluation
packages/cli/src/commands/task-*.ts      — CLI commands for tasks
```

## Testing Strategy

- Unit tests per package for new functions (following existing 100% coverage pattern)
- Integration tests: bot A creates task on bot B via real HTTP
- Integration tests: KV store concurrent read/write
- Integration tests: broadcast with 3-bot mesh
- Workflow tests: event gate with topic trigger

## Non-Goals

- **A2A protocol compliance** — We borrow concepts, not the wire protocol. Mecha bots are not generic A2A endpoints.
- **Cross-vendor interop** — Mecha bots talk to mecha bots. Interop with CrewAI/AutoGen agents is out of scope.
- **Distributed consensus** — KV store is single-node (filesystem-backed). No Raft/Paxos. Multi-node sync uses bus replication.

## Migration

All changes are additive. Existing `mesh_query` and bus tools continue to work unchanged. New tools are opt-in.
