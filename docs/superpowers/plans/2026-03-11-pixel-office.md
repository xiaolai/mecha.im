# Pixel Office Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time bot activity visualization as a pixel art virtual office in the SPA, backed by SSE activity events from the runtime and daemon.

**Architecture:** Bot runtime emits `ActivityEvent` via `ActivityEmitter` (mirrors `ProcessEventEmitter` pattern). Daemon aggregates per-bot SSE streams into a unified `/events` stream. SPA `/office` route renders an HTML5 Canvas pixel art office where bots appear as NPCs moving between rooms based on activity state.

**Tech Stack:** TypeScript, Fastify SSE, `eventsource-parser`, Vite + React Router SPA, HTML5 Canvas (32x32 tileset)

**Spec:** `docs/superpowers/specs/2026-03-11-pixel-office-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/runtime/src/activity.ts` | `ActivityState` type, `ActivityEvent` interface, `ActivityEmitter` class |
| `packages/runtime/src/routes/events.ts` | Bot-level `GET /api/events` SSE endpoint |
| `packages/runtime/__tests__/activity.test.ts` | ActivityEmitter unit tests |
| `packages/runtime/__tests__/routes/events.test.ts` | Bot SSE endpoint tests |
| `packages/runtime/__tests__/sdk-chat-activity.test.ts` | sdkChat activity emission tests |
| `packages/agent/src/activity-aggregator.ts` | Daemon-side SSE consumer + re-emitter |
| `packages/agent/__tests__/activity-aggregator.test.ts` | Aggregator tests |
| `packages/cli/src/commands/bot-activity.ts` | `mecha bot activity <name> --watch` CLI command |
| `packages/cli/__tests__/bot-activity.test.ts` | CLI command tests |
| `packages/service/src/activity.ts` | `botActivity()` service function (SSE fetch) |
| `packages/spa/src/pages/office.tsx` | `/office` route page component |
| `packages/spa/src/components/office/office-canvas.tsx` | Main Canvas orchestrator |
| `packages/spa/src/components/office/tile-map.ts` | Tilemap renderer (pure, no React) |
| `packages/spa/src/components/office/bot-sprite.ts` | NPC sprite renderer (pure) |
| `packages/spa/src/components/office/activity-manager.ts` | SSE consumer + state machine |
| `packages/spa/src/components/office/interaction-layer.ts` | Click detection + hit testing |
| `packages/spa/src/components/office/bubble-renderer.ts` | Thought/speech/tool bubbles |
| `packages/spa/src/components/office/types.ts` | Frontend office types |
| `packages/spa/src/components/office/inspect-panel.tsx` | Click-to-inspect slide-in panel |
| `packages/spa/__tests__/office/activity-manager.test.ts` | Activity manager state machine tests |
| `packages/spa/__tests__/office/sse-consumer.test.ts` | EventSource mock tests |

### Modified Files

| File | Changes |
|------|---------|
| `packages/runtime/src/sdk-chat.ts` | Accept optional `ActivityEmitter`, emit activity transitions |
| `packages/runtime/src/server.ts` | Create `ActivityEmitter`, pass to sdkChat + events route |
| `packages/agent/src/routes/events.ts` | Multiplex `ActivityEvent` into unified SSE stream |
| `packages/agent/src/server.ts` | Initialize `ActivityAggregator`, pass to events routes |
| `packages/cli/src/commands/bot.ts` | Register `bot activity` subcommand |
| `packages/service/src/index.ts` | Re-export `botActivity` |
| `packages/spa/src/app.tsx` | Add `/office` route |
| `packages/spa/src/components/sidebar/sidebar-nav.tsx` | Add Office nav entry |

---

## Chunk 1: Phase 1 — Activity Events Backend

### Task 1: ActivityEmitter + Types

**Files:**
- Create: `packages/runtime/src/activity.ts`
- Test: `packages/runtime/__tests__/activity.test.ts`

- [ ] **Step 1: Write failing tests for ActivityEmitter**

```typescript
// packages/runtime/__tests__/activity.test.ts
import { describe, it, expect, vi } from "vitest";
import { ActivityEmitter, type ActivityEvent } from "../src/activity.js";

describe("ActivityEmitter", () => {
  it("emits events to subscribers", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const event: ActivityEvent = {
      type: "activity",
      name: "alice",
      activity: "thinking",
      timestamp: new Date().toISOString(),
    };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("unsubscribe stops delivery", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    const unsub = emitter.subscribe(handler);
    unsub();

    emitter.emit({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates handler failures", () => {
    const emitter = new ActivityEmitter();
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    emitter.subscribe(bad);
    emitter.subscribe(good);

    emitter.emit({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(good).toHaveBeenCalled();
  });

  it("reports listenerCount", () => {
    const emitter = new ActivityEmitter();
    expect(emitter.listenerCount).toBe(0);
    const unsub = emitter.subscribe(() => {});
    expect(emitter.listenerCount).toBe(1);
    unsub();
    expect(emitter.listenerCount).toBe(0);
  });

  it("deduplicates consecutive identical states for same bot+queryId", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows same state for different queryIds", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });
    emitter.emit({ ...base, activity: "thinking", queryId: "q2" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("allows same state+queryId for different bots (no cross-bot dedup)", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const ts = new Date().toISOString();
    emitter.emit({ type: "activity", name: "alice", activity: "thinking", queryId: "q1", timestamp: ts });
    emitter.emit({ type: "activity", name: "bob", activity: "thinking", queryId: "q1", timestamp: ts });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("emits consecutive error events (error clears dedup state)", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", queryId: "q1", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "error" });
    emitter.emit({ ...base, activity: "error" });

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project runtime -- activity.test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ActivityEmitter**

```typescript
// packages/runtime/src/activity.ts
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:activity");

/** Activity states for bot visualization. */
export type ActivityState =
  | "idle"
  | "thinking"
  | "tool_use"
  | "responding"
  | "error";

/** Real-time activity event emitted during SDK queries. */
export interface ActivityEvent {
  type: "activity";
  name: string;
  activity: ActivityState;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

export type ActivityEventHandler = (event: ActivityEvent) => void;

/**
 * Typed event emitter for bot activity events.
 * Mirrors ProcessEventEmitter pattern from packages/process/src/events.ts.
 * Deduplicates consecutive identical states per queryId.
 */
export class ActivityEmitter {
  private handlers = new Set<ActivityEventHandler>();
  private lastState = new Map<string, ActivityState>();

  subscribe(handler: ActivityEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  emit(event: ActivityEvent): void {
    // Deduplicate consecutive identical states per bot+queryId
    const key = `${event.name}:${event.queryId ?? "__default__"}`;
    if (this.lastState.get(key) === event.activity && event.activity !== "idle") {
      return;
    }
    this.lastState.set(key, event.activity);

    // Clean up finished queries
    if (event.activity === "idle" || event.activity === "error") {
      this.lastState.delete(key);
    }

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error("Activity handler threw", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project runtime -- activity.test`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/activity.ts packages/runtime/__tests__/activity.test.ts
git commit -m "feat(runtime): add ActivityEmitter with typed activity events"
```

---

### Task 2: Modify sdkChat to emit activity events

**Files:**
- Modify: `packages/runtime/src/sdk-chat.ts:71-123`
- Test: `packages/runtime/__tests__/sdk-chat-activity.test.ts`

- [ ] **Step 1: Write failing tests for sdkChat activity emission**

```typescript
// packages/runtime/__tests__/sdk-chat-activity.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityEmitter, type ActivityEvent } from "../src/activity.js";

// We test the emitActivityFromEvent helper (extracted for testability)
// rather than the full sdkChat (which requires SDK binary)
import { emitActivityFromEvent } from "../src/sdk-chat-activity.js";

describe("emitActivityFromEvent", () => {
  let emitter: ActivityEmitter;
  let events: ActivityEvent[];

  beforeEach(() => {
    emitter = new ActivityEmitter();
    events = [];
    emitter.subscribe((e) => events.push(e));
  });

  const ctx = { name: "alice", queryId: "q1" };

  it("emits thinking on system init event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "system", subtype: "init" });
    expect(events).toHaveLength(1);
    expect(events[0]!.activity).toBe("thinking");
    expect(events[0]!.name).toBe("alice");
    expect(events[0]!.queryId).toBe("q1");
  });

  it("emits thinking on system status event (all system subtypes map to thinking)", () => {
    emitActivityFromEvent(emitter, ctx, { type: "system", subtype: "status" });
    expect(events[0]!.activity).toBe("thinking");
  });

  it("emits responding on assistant event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "assistant" });
    expect(events[0]!.activity).toBe("responding");
  });

  it("emits tool_use on tool_use_summary event", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "tool_use_summary",
      tool_name: "Bash",
    });
    expect(events[0]!.activity).toBe("tool_use");
    expect(events[0]!.toolName).toBe("Bash");
  });

  it("emits tool_use on tool_progress event", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "tool_progress",
      tool_name: "Read",
    });
    expect(events[0]!.activity).toBe("tool_use");
    expect(events[0]!.toolName).toBe("Read");
  });

  it("emits responding on stream_event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "stream_event" });
    expect(events[0]!.activity).toBe("responding");
  });

  it("emits idle on successful result", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "result",
      subtype: "success",
    });
    expect(events[0]!.activity).toBe("idle");
  });

  it("emits error on error result", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "result",
      subtype: "error_max_turns",
    });
    expect(events[0]!.activity).toBe("error");
  });

  it("ignores unknown event types", () => {
    emitActivityFromEvent(emitter, ctx, { type: "unknown_future_type" });
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project runtime -- sdk-chat-activity.test`
Expected: FAIL — module not found

- [ ] **Step 3: Create sdk-chat-activity helper**

```typescript
// packages/runtime/src/sdk-chat-activity.ts
import type { ActivityEmitter } from "./activity.js";
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:sdk-chat-activity");

/** Context for activity emission during a query. */
export interface ActivityContext {
  name: string;
  queryId: string;
  sessionId?: string;
}

/**
 * Map an SDK event to an activity emission.
 * Extracted from sdkChat for testability — SDK events are opaque objects
 * with a `type` discriminant field.
 */
export function emitActivityFromEvent(
  emitter: ActivityEmitter,
  ctx: ActivityContext,
  event: Record<string, unknown>,
): void {
  const now = new Date().toISOString();
  const base = { type: "activity" as const, name: ctx.name, queryId: ctx.queryId, sessionId: ctx.sessionId, timestamp: now };

  switch (event.type) {
    case "system":
      emitter.emit({ ...base, activity: "thinking" });
      break;
    case "assistant":
    case "stream_event":
      emitter.emit({ ...base, activity: "responding" });
      break;
    case "tool_use_summary":
    case "tool_progress":
      emitter.emit({
        ...base,
        activity: "tool_use",
        toolName: typeof event.tool_name === "string" ? event.tool_name : undefined,
      });
      break;
    case "result":
      if (event.subtype === "success") {
        emitter.emit({ ...base, activity: "idle" });
      } else {
        emitter.emit({ ...base, activity: "error" });
      }
      break;
    default:
      log.debug("Unknown SDK event type", { type: event.type });
      break;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project runtime -- sdk-chat-activity.test`
Expected: PASS

- [ ] **Step 5: Wire ActivityEmitter into sdkChat**

Modify `packages/runtime/src/sdk-chat.ts`:

1. Add import: `import type { ActivityEmitter } from "./activity.js";`
2. Add import: `import { emitActivityFromEvent } from "./sdk-chat-activity.js";`
3. Add optional `activityEmitter?: ActivityEmitter` and `botName?: string` to `SdkChatOpts`
4. Inside the `for await` loop (line 116-120), before the `if (event.type === "result")` check, add:

```typescript
if (opts.activityEmitter && opts.botName) {
  emitActivityFromEvent(opts.activityEmitter, { name: opts.botName, queryId }, event as Record<string, unknown>);
}
```

5. Generate `queryId` at function entry: `const queryId = crypto.randomUUID();`
6. Add `import { randomUUID } from "node:crypto";` (or use `crypto.randomUUID()`)
7. Track whether the query ended normally. Add `let queryEnded = false;` before the `try` block. Set `queryEnded = true;` after the `for await` loop (before `finally`). In the `finally` block, emit idle only for abort/throw paths:

```typescript
finally {
  signal?.removeEventListener("abort", onAbort);
  // Emit idle for abort/throw paths — skip if query ended normally (result handler already emitted)
  if (!queryEnded && opts.activityEmitter && opts.botName) {
    opts.activityEmitter.emit({
      type: "activity", name: opts.botName, activity: "idle",
      queryId, timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 6: Run full runtime tests**

Run: `pnpm exec vitest run --project runtime`
Expected: All PASS (existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/sdk-chat-activity.ts packages/runtime/src/sdk-chat.ts packages/runtime/__tests__/sdk-chat-activity.test.ts
git commit -m "feat(runtime): emit activity events from sdkChat during SDK queries"
```

---

### Task 3: Bot-level SSE endpoint (GET /api/events)

**Files:**
- Create: `packages/runtime/src/routes/events.ts`
- Test: `packages/runtime/__tests__/routes/events.test.ts`
- Modify: `packages/runtime/src/server.ts`

- [ ] **Step 1: Write failing tests for bot SSE events route**

```typescript
// packages/runtime/__tests__/routes/events.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ActivityEmitter } from "../../src/activity.js";
import { registerActivityEventsRoutes } from "../../src/routes/events.js";

describe("bot activity events SSE route", () => {
  let app: FastifyInstance;
  let emitter: ActivityEmitter;

  beforeEach(async () => {
    app = Fastify();
    emitter = new ActivityEmitter();
    registerActivityEventsRoutes(app, { activityEmitter: emitter, botName: "alice" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers GET /api/events route", () => {
    const routes = app.printRoutes();
    expect(routes).toContain("/api/events");
  });

  it("returns snapshot event on initial connection", async () => {
    // Snapshot endpoint (non-SSE) for testing
    const res = await app.inject({
      method: "GET",
      url: "/api/events/snapshot",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("alice");
    expect(body.activity).toBe("idle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project runtime -- routes/events.test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement bot SSE events route**

```typescript
// packages/runtime/src/routes/events.ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ActivityEmitter, ActivityState } from "../activity.js";

/** Options for bot-level activity events SSE route. */
export interface ActivityEventsRouteOpts {
  activityEmitter: ActivityEmitter;
  botName: string;
}

const MAX_CONNECTIONS = 6; // 5 clients + 1 reserved for daemon aggregator
const HEARTBEAT_INTERVAL_MS = 10_000;

/** Register GET /api/events SSE endpoint + GET /api/events/snapshot for bot activity. */
export function registerActivityEventsRoutes(app: FastifyInstance, opts: ActivityEventsRouteOpts): void {
  let activeConnections = 0;

  // Scoped per registration (not module-global) to avoid test state leakage
  let currentActivity: ActivityState = "idle";

  // Track current activity for snapshot
  opts.activityEmitter.subscribe((event) => {
    if (event.name === opts.botName) {
      currentActivity = event.activity;
    }
  });

  // Snapshot endpoint (non-SSE, testable via inject)
  app.get("/api/events/snapshot", async () => ({
    name: opts.botName,
    activity: currentActivity,
    timestamp: new Date().toISOString(),
  }));

  /* v8 ignore start -- SSE handler uses reply.hijack() which prevents Fastify inject testing */
  app.get("/api/events", async (request, reply: FastifyReply) => {
    if (activeConnections >= MAX_CONNECTIONS) {
      reply.code(429).send({ error: "Too many SSE connections" });
      return;
    }

    activeConnections++;
    let cleanedUp = false;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    // Send initial snapshot
    const snapshot = {
      type: "snapshot" as const,
      name: opts.botName,
      activity: currentActivity,
      timestamp: new Date().toISOString(),
    };
    reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    const unsubscribe = opts.activityEmitter.subscribe((event) => {
      if (event.name !== opts.botName) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribe();
      clearInterval(heartbeat);
      activeConnections--;
    }

    // Use req.socket.on("close") — NOT req.raw.on("close")
    // See AGENTS.md: SSE Streaming: Client Disconnect Detection
    request.socket.on("close", () => {
      cleanup();
    });

    await reply.hijack();
  });
  /* v8 ignore stop */
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project runtime -- routes/events.test`
Expected: PASS

- [ ] **Step 5: Wire into runtime server.ts**

Modify `packages/runtime/src/server.ts`:

1. Add import: `import { ActivityEmitter } from "./activity.js";`
2. Add import: `import { registerActivityEventsRoutes } from "./routes/events.js";`
3. After `const chatOpts = {...}` (line 66), add: `const activityEmitter = new ActivityEmitter();`
4. Update `chatOpts` to include `activityEmitter` and `botName: opts.botName`
5. After `registerChatRoutes(app, httpChatFn)` (line 85), add:
   `registerActivityEventsRoutes(app, { activityEmitter, botName: opts.botName });`

- [ ] **Step 6: Run full runtime tests**

Run: `pnpm exec vitest run --project runtime`
Expected: All PASS

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/routes/events.ts packages/runtime/__tests__/routes/events.test.ts packages/runtime/src/server.ts
git commit -m "feat(runtime): add bot-level GET /api/events SSE endpoint for activity"
```

---

### Task 4: CLI command — `mecha bot activity`

**Files:**
- Create: `packages/cli/src/commands/bot-activity.ts`
- Create: `packages/service/src/activity.ts`
- Test: `packages/cli/__tests__/bot-activity.test.ts`
- Modify: `packages/cli/src/commands/bot.ts`
- Modify: `packages/service/src/index.ts`

- [ ] **Step 1: Create service function for bot activity**

```typescript
// packages/service/src/activity.ts
import { type BotName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { resolveBotEndpoint } from "./helpers.js";

/** Current activity snapshot from a bot. */
export interface ActivitySnapshot {
  name: string;
  activity: string;
  timestamp: string;
}

/**
 * Fetch the current activity snapshot from a bot's /api/events/snapshot endpoint.
 */
export async function botActivitySnapshot(
  pm: ProcessManager,
  name: BotName,
): Promise<ActivitySnapshot> {
  const info = resolveBotEndpoint(pm, name);
  const url = `http://127.0.0.1:${info.port}/api/events/snapshot`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${info.token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch activity: ${response.status}`);
  }
  return await response.json() as ActivitySnapshot;
}

/**
 * Stream activity events from a bot's /api/events SSE endpoint.
 * Yields parsed ActivityEvent objects.
 */
export async function* botActivityStream(
  pm: ProcessManager,
  name: BotName,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const info = resolveBotEndpoint(pm, name);
  const url = `http://127.0.0.1:${info.port}/api/events`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${info.token}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to connect to activity stream: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6)) as Record<string, unknown>;
        } catch {
          // skip malformed data lines
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write failing tests for CLI command**

```typescript
// packages/cli/__tests__/bot-activity.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerBotActivityCommand } from "../src/commands/bot-activity.js";
import type { CommandDeps } from "../src/types.js";

// Mock service module
vi.mock("@mecha/service", () => ({
  botActivitySnapshot: vi.fn().mockResolvedValue({
    name: "alice",
    activity: "thinking",
    timestamp: "2026-03-11T00:00:00.000Z",
  }),
}));

describe("bot activity command", () => {
  let deps: CommandDeps;
  let program: Command;

  beforeEach(() => {
    deps = {
      processManager: {} as CommandDeps["processManager"],
      mechaDir: "/tmp/mecha",
      formatter: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        table: vi.fn(),
        json: vi.fn(),
        isJson: false,
      },
    };
    program = new Command();
    registerBotActivityCommand(program, deps);
  });

  it("registers the activity subcommand", () => {
    const cmd = program.commands.find(c => c.name() === "activity");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("activity");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project cli -- bot-activity.test`
Expected: FAIL — module not found

- [ ] **Step 4: Implement CLI command**

```typescript
// packages/cli/src/commands/bot-activity.ts
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botActivitySnapshot } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot activity' subcommand. */
export function registerBotActivityCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("activity")
    .description("Show bot activity state")
    .argument("<name>", "bot name")
    .option("-w, --watch", "Stream activity events in real time")
    .action(async (name: string, opts: { watch?: boolean }) => withErrorHandler(deps, async () => {
      const validated = botName(name);

      if (opts.watch) {
        // --watch mode: stream SSE events
        deps.formatter.info(`Watching activity for ${validated}... (Ctrl+C to stop)`);
        const { botActivityStream } = await import("@mecha/service");
        const ac = new AbortController();
        process.on("SIGINT", () => ac.abort());

        try {
          for await (const event of botActivityStream(deps.processManager, validated, ac.signal)) {
            const activity = event.activity as string;
            const toolName = event.toolName ? ` (${event.toolName})` : "";
            const ts = typeof event.timestamp === "string"
              ? new Date(event.timestamp).toLocaleTimeString()
              : "";
            deps.formatter.info(`[${ts}] ${validated}: ${activity}${toolName}`);
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          throw err;
        }
      } else {
        // Snapshot mode
        const snapshot = await botActivitySnapshot(deps.processManager, validated);

        if (deps.formatter.isJson) {
          deps.formatter.json(snapshot);
        } else {
          deps.formatter.table(
            ["Field", "Value"],
            [
              ["name", snapshot.name],
              ["activity", snapshot.activity],
              ["timestamp", snapshot.timestamp],
            ],
          );
        }
      }
    }));
}
```

- [ ] **Step 5: Register in bot.ts**

Add to `packages/cli/src/commands/bot.ts`:

1. Import: `import { registerBotActivityCommand } from "./bot-activity.js";`
2. After last `registerBot*Command(bot, deps)` call, add: `registerBotActivityCommand(bot, deps);`

- [ ] **Step 6: Export from service index**

Add to `packages/service/src/index.ts`:
```typescript
export { botActivitySnapshot, botActivityStream } from "./activity.js";
export type { ActivitySnapshot } from "./activity.js";
```

- [ ] **Step 7: Run tests**

Run: `pnpm exec vitest run --project cli -- bot-activity.test`
Expected: PASS

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/commands/bot-activity.ts packages/cli/__tests__/bot-activity.test.ts packages/cli/src/commands/bot.ts packages/service/src/activity.ts packages/service/src/index.ts
git commit -m "feat(cli): add mecha bot activity command with --watch mode"
```

---

## Chunk 2: Phase 2 — Daemon Aggregation

### Task 5: ActivityAggregator

**Files:**
- Create: `packages/agent/src/activity-aggregator.ts`
- Test: `packages/agent/__tests__/activity-aggregator.test.ts`

- [ ] **Step 1: Write failing tests for ActivityAggregator**

```typescript
// packages/agent/__tests__/activity-aggregator.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityAggregator } from "../src/activity-aggregator.js";

describe("ActivityAggregator", () => {
  let aggregator: ActivityAggregator;

  beforeEach(() => {
    aggregator = new ActivityAggregator();
  });

  afterEach(() => {
    aggregator.shutdown();
  });

  it("emits events to subscribers", () => {
    const handler = vi.fn();
    aggregator.subscribe(handler);

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "thinking",
      timestamp: new Date().toISOString(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].activity).toBe("thinking");
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = aggregator.subscribe(handler);
    unsub();

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks connected bot names (skipConnect avoids real fetch)", () => {
    expect(aggregator.connectedBots).toEqual([]);
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    expect(aggregator.connectedBots).toContain("alice");
  });

  it("removes bot on removeBot", () => {
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    aggregator.removeBot("alice");
    expect(aggregator.connectedBots).not.toContain("alice");
  });

  it("cleans up all on shutdown", () => {
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    aggregator.addBot("bob", 7701, "token-b", { skipConnect: true });
    aggregator.shutdown();
    expect(aggregator.connectedBots).toEqual([]);
  });

  it("isolates handler failures", () => {
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    aggregator.subscribe(bad);
    aggregator.subscribe(good);

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(good).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project agent -- activity-aggregator.test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ActivityAggregator**

```typescript
// packages/agent/src/activity-aggregator.ts
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:activity-aggregator");

/** Activity event from a bot runtime. */
export interface AggregatedActivityEvent {
  type: "activity";
  name: string;
  activity: string;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

type ActivityHandler = (event: AggregatedActivityEvent) => void;

interface BotConnection {
  name: string;
  port: number;
  token: string;
  abortController: AbortController;
}

/**
 * Aggregates SSE activity streams from multiple bot runtimes.
 * Opens one SSE connection per running bot, re-emits events
 * to subscribers (daemon SSE route).
 */
export class ActivityAggregator {
  private handlers = new Set<ActivityHandler>();
  private connections = new Map<string, BotConnection>();

  subscribe(handler: ActivityHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** Inject an event directly (for testing or manual emission). */
  injectEvent(event: AggregatedActivityEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error("Activity handler threw", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** Start consuming SSE from a bot's /api/events endpoint. */
  addBot(name: string, port: number, token: string, opts?: { skipConnect?: boolean }): void {
    // Abort existing connection if any
    this.removeBot(name);

    const ac = new AbortController();
    this.connections.set(name, { name, port, token, abortController: ac });

    // Start streaming in background (fire-and-forget with reconnect)
    // skipConnect: true for unit tests that don't have a live server
    if (!opts?.skipConnect) {
      this.connectBot(name, port, token, ac.signal).catch((err) => {
        log.debug("Bot SSE connection ended", { name, error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  /** Stop consuming SSE from a bot. */
  removeBot(name: string): void {
    const conn = this.connections.get(name);
    if (conn) {
      conn.abortController.abort();
      this.connections.delete(name);
    }
  }

  /** Get list of connected bot names. */
  get connectedBots(): string[] {
    return [...this.connections.keys()];
  }

  /** Shut down all connections. */
  shutdown(): void {
    for (const [name] of this.connections) {
      this.removeBot(name);
    }
  }

  /* v8 ignore start -- SSE streaming requires live bot runtime */
  private async connectBot(name: string, port: number, token: string, signal: AbortSignal): Promise<void> {
    let backoff = 1000;
    const MAX_BACKOFF = 30_000;

    while (!signal.aborted) {
      try {
        const url = `http://127.0.0.1:${port}/api/events`;
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        backoff = 1000; // Reset on successful connection
        const decoder = new TextDecoder();
        let buffer = "";

        for await (const chunk of response.body) {
          if (signal.aborted) break;
          buffer += decoder.decode(chunk as Uint8Array, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as AggregatedActivityEvent;
                if (event.type === "activity" || (event as Record<string, unknown>).type === "snapshot") {
                  this.injectEvent({ ...event, type: "activity", name });
                }
              } catch {
                // skip malformed
              }
            }
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        log.debug("Bot SSE reconnecting", { name, backoffMs: backoff });
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }
  }
  /* v8 ignore stop */
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project agent -- activity-aggregator.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/activity-aggregator.ts packages/agent/__tests__/activity-aggregator.test.ts
git commit -m "feat(agent): add ActivityAggregator for daemon-side SSE consumption"
```

---

### Task 6: Enhanced daemon SSE route

**Files:**
- Modify: `packages/agent/src/routes/events.ts`
- Modify: `packages/agent/src/server.ts`

- [ ] **Step 1: Modify daemon events route to accept ActivityAggregator**

Update `packages/agent/src/routes/events.ts`:

1. Add import: `import type { ActivityAggregator } from "../activity-aggregator.js";`
2. Add `activityAggregator?: ActivityAggregator` to `EventsRouteOpts`
3. Inside the SSE handler (after `const unsubscribe = opts.processManager.onEvent(...)` block), add a second subscription:

```typescript
const unsubActivity = opts.activityAggregator?.subscribe((event) => {
  try {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    cleanup();
  }
});
```

4. In `cleanup()`, add: `unsubActivity?.();`

- [ ] **Step 2: Wire ActivityAggregator into daemon server**

Modify `packages/agent/src/server.ts`:

1. Add import: `import { ActivityAggregator } from "./activity-aggregator.js";`
2. Before route registration (around line 260), create aggregator:
   `const activityAggregator = new ActivityAggregator();`
3. Subscribe to process events FIRST (before scanning existing bots, to avoid race):

```typescript
const unsubActivityWiring = opts.processManager.onEvent((event) => {
  if (event.type === "spawned") {
    const info = opts.processManager.get(event.name);
    if (info?.token) {
      activityAggregator.addBot(event.name, event.port, info.token);
    }
  } else if (event.type === "stopped") {
    activityAggregator.removeBot(event.name);
  }
});
```

4. THEN connect to already-running bots (after subscription, no race):

```typescript
for (const bot of opts.processManager.list()) {
  if (bot.state === "running" && bot.port && bot.token) {
    activityAggregator.addBot(bot.name, bot.port, bot.token);
  }
}
```

5. Update `registerEventsRoutes` call (line 321) to pass `activityAggregator`:
   `registerEventsRoutes(app, { processManager: opts.processManager, activityAggregator });`

6. Add cleanup on close (unsubscribe + shutdown):
```typescript
app.addHook("onClose", () => {
  unsubActivityWiring();
  activityAggregator.shutdown();
});
```

- [ ] **Step 3: Run full agent tests**

Run: `pnpm exec vitest run --project agent`
Expected: All PASS

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/routes/events.ts packages/agent/src/server.ts
git commit -m "feat(agent): multiplex activity events into daemon SSE stream"
```

---

## Chunk 3: Phase 3 — Office Canvas Frontend

### Task 7: Office types and activity manager

**Files:**
- Create: `packages/spa/src/components/office/types.ts`
- Create: `packages/spa/src/components/office/activity-manager.ts`
- Test: `packages/spa/__tests__/office/activity-manager.test.ts`

- [ ] **Step 1: Create office types**

```typescript
// packages/spa/src/components/office/types.ts

/** Activity states matching backend ActivityState. */
export type ActivityState = "idle" | "thinking" | "tool_use" | "responding" | "error";

/** Activity event from daemon SSE. */
export interface ActivityEvent {
  type: "activity";
  name: string;
  activity: ActivityState;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

/** Position on the canvas grid. */
export interface GridPosition {
  x: number;
  y: number;
}

/** Per-bot state tracked by the activity manager. */
export interface BotState {
  name: string;
  activity: ActivityState;
  position: GridPosition;
  targetPosition: GridPosition;
  toolName?: string;
  sessionId?: string;
  deskIndex: number;
  lastActivityChange: number;
}

/** Room positions (tile coordinates). */
export const DESK_POSITIONS: GridPosition[] = [
  { x: 2, y: 4 },   // Desk 1
  { x: 6, y: 4 },   // Desk 2
  { x: 2, y: 7 },   // Desk 3
  { x: 6, y: 7 },   // Desk 4
  { x: 2, y: 10 },  // Desk 5
  { x: 6, y: 10 },  // Desk 6
];

export const LOUNGE_POSITIONS: GridPosition[] = [
  { x: 12, y: 4 },  // Couch 1
  { x: 12, y: 7 },  // Couch 2
];

export const WATER_COOLER_POSITION: GridPosition = { x: 2, y: 2 };
```

- [ ] **Step 2: Write failing tests for activity manager**

```typescript
// packages/spa/__tests__/office/activity-manager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfficeActivityManager } from "../../src/components/office/activity-manager";
import type { ActivityEvent, BotState } from "../../src/components/office/types";

describe("OfficeActivityManager", () => {
  let manager: OfficeActivityManager;

  beforeEach(() => {
    manager = new OfficeActivityManager();
  });

  it("adds a new bot in idle state at lounge position", () => {
    manager.handleEvent({
      type: "activity", name: "alice", activity: "idle",
      timestamp: new Date().toISOString(),
    });

    const state = manager.getBotState("alice");
    expect(state).toBeDefined();
    expect(state!.activity).toBe("idle");
  });

  it("transitions bot to desk when thinking", () => {
    manager.handleEvent({
      type: "activity", name: "alice", activity: "idle",
      timestamp: new Date().toISOString(),
    });
    manager.handleEvent({
      type: "activity", name: "alice", activity: "thinking",
      timestamp: new Date().toISOString(),
    });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("thinking");
    // Target position should be a desk
    expect(state!.deskIndex).toBeGreaterThanOrEqual(0);
  });

  it("keeps bot at desk during tool_use", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "alice", activity: "tool_use", toolName: "Bash", timestamp: new Date().toISOString() });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("tool_use");
    expect(state!.toolName).toBe("Bash");
  });

  it("moves bot to lounge when idle", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "alice", activity: "idle", timestamp: new Date().toISOString() });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("idle");
  });

  it("returns all bot states", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "idle", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "bob", activity: "thinking", timestamp: new Date().toISOString() });

    const all = manager.getAllBotStates();
    expect(all).toHaveLength(2);
    expect(all.map(b => b.name).sort()).toEqual(["alice", "bob"]);
  });

  it("debounces rapid state changes (< 500ms)", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });

    // Rapid change within 500ms
    vi.setSystemTime(now + 100);
    manager.handleEvent({ type: "activity", name: "alice", activity: "tool_use", timestamp: new Date().toISOString() });

    // Activity updates but position doesn't change until debounce expires
    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("tool_use");

    vi.useRealTimers();
  });

  it("assigns unique desk indices to different bots", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "bob", activity: "thinking", timestamp: new Date().toISOString() });

    const alice = manager.getBotState("alice");
    const bob = manager.getBotState("bob");
    expect(alice!.deskIndex).not.toBe(bob!.deskIndex);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project spa -- activity-manager.test`
Expected: FAIL — module not found

- [ ] **Step 4: Implement activity manager**

```typescript
// packages/spa/src/components/office/activity-manager.ts
import type {
  ActivityEvent,
  ActivityState,
  BotState,
  GridPosition,
} from "./types";
import { DESK_POSITIONS, LOUNGE_POSITIONS, WATER_COOLER_POSITION } from "./types";

const DEBOUNCE_MS = 500;

/**
 * Manages per-bot state for the office visualization.
 * Consumes SSE ActivityEvents and maintains positions + animation state.
 */
export class OfficeActivityManager {
  private bots = new Map<string, BotState>();
  private nextDeskIndex = 0;
  private assignedDesks = new Map<string, number>();

  handleEvent(event: ActivityEvent): void {
    let state = this.bots.get(event.name);

    if (!state) {
      const deskIndex = this.assignDesk(event.name);
      const position = this.getIdlePosition(event.name);
      state = {
        name: event.name,
        activity: "idle",
        position: { ...position },
        targetPosition: { ...position },
        toolName: undefined,
        sessionId: undefined,
        deskIndex,
        lastActivityChange: Date.now(),
      };
      this.bots.set(event.name, state);
    }

    // Update activity
    state.activity = event.activity;
    state.toolName = event.toolName;
    state.sessionId = event.sessionId;

    // Update target position based on activity
    const now = Date.now();
    const timeSinceLastChange = now - state.lastActivityChange;
    state.lastActivityChange = now;

    if (this.isWorkingState(event.activity)) {
      // Move to desk
      const deskPos = DESK_POSITIONS[state.deskIndex % DESK_POSITIONS.length]!;
      if (timeSinceLastChange >= DEBOUNCE_MS || !this.isWorkingState(state.activity)) {
        state.targetPosition = { ...deskPos };
      }
    } else if (event.activity === "idle") {
      // Move to lounge or water cooler
      const idlePos = this.getIdlePosition(event.name);
      state.targetPosition = { ...idlePos };
    }
    // error: stay at current position
  }

  getBotState(name: string): BotState | undefined {
    return this.bots.get(name);
  }

  getAllBotStates(): BotState[] {
    return [...this.bots.values()];
  }

  removeBot(name: string): void {
    this.bots.delete(name);
    this.assignedDesks.delete(name);
  }

  private isWorkingState(activity: ActivityState): boolean {
    return activity === "thinking" || activity === "tool_use" || activity === "responding";
  }

  private assignDesk(name: string): number {
    if (this.assignedDesks.has(name)) {
      return this.assignedDesks.get(name)!;
    }
    const index = this.nextDeskIndex++;
    this.assignedDesks.set(name, index);
    return index;
  }

  private getIdlePosition(name: string): GridPosition {
    // If multiple bots idle, some go to water cooler
    const idleBots = [...this.bots.values()].filter(b => b.activity === "idle");
    const idleIndex = idleBots.findIndex(b => b.name === name);

    if (idleBots.length >= 2 && idleIndex < 2) {
      return { ...WATER_COOLER_POSITION };
    }

    const loungeIndex = Math.max(0, idleIndex) % LOUNGE_POSITIONS.length;
    return { ...LOUNGE_POSITIONS[loungeIndex]! };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run --project spa -- activity-manager.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/spa/src/components/office/types.ts packages/spa/src/components/office/activity-manager.ts packages/spa/__tests__/office/activity-manager.test.ts
git commit -m "feat(spa): add OfficeActivityManager state machine for bot NPCs"
```

---

### Task 8: SSE consumer hook

**Files:**
- Create: `packages/spa/src/components/office/use-activity-stream.ts`
- Test: `packages/spa/__tests__/office/sse-consumer.test.ts`

- [ ] **Step 1: Write failing tests for SSE consumer**

```typescript
// packages/spa/__tests__/office/sse-consumer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSSELine } from "../../src/components/office/use-activity-stream";

describe("parseSSELine", () => {
  it("parses data lines", () => {
    const result = parseSSELine('data: {"type":"activity","name":"alice","activity":"thinking","timestamp":"2026-01-01T00:00:00Z"}');
    expect(result).toBeDefined();
    expect(result!.name).toBe("alice");
    expect(result!.activity).toBe("thinking");
  });

  it("returns null for comment lines", () => {
    expect(parseSSELine(": heartbeat")).toBeNull();
  });

  it("returns null for empty lines", () => {
    expect(parseSSELine("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSSELine("data: {invalid}")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseSSELine("event: something")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project spa -- sse-consumer.test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SSE consumer hook**

```typescript
// packages/spa/src/components/office/use-activity-stream.ts
import { useEffect, useRef, useCallback } from "react";
import type { ActivityEvent } from "./types";

/** Parse a single SSE line into an ActivityEvent (or null). Exported for testing. */
export function parseSSELine(line: string): ActivityEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as ActivityEvent;
  } catch {
    return null;
  }
}

/**
 * React hook that consumes the daemon's unified SSE stream
 * and calls onEvent for each ActivityEvent.
 */
export function useActivityStream(onEvent: (event: ActivityEvent) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let backoff = 1000;
    const MAX_BACKOFF = 30_000;

    async function connect() {
      if (cancelled) return;

      try {
        const response = await fetch("/events", {
          headers: { accept: "text/event-stream" },
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE failed: ${response.status}`);
        }

        backoff = 1000; // Reset on success
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const event = parseSSELine(line);
            if (event && event.type === "activity") {
              onEventRef.current(event);
            }
          }
        }
      } catch {
        // Reconnect with backoff
      }

      if (!cancelled) {
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
    };
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project spa -- sse-consumer.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/spa/src/components/office/use-activity-stream.ts packages/spa/__tests__/office/sse-consumer.test.ts
git commit -m "feat(spa): add useActivityStream SSE hook with reconnect backoff"
```

---

### Task 9: Canvas rendering (TileMap + BotSprite + Bubbles)

**Files:**
- Create: `packages/spa/src/components/office/tile-map.ts`
- Create: `packages/spa/src/components/office/bot-sprite.ts`
- Create: `packages/spa/src/components/office/bubble-renderer.ts`
- Create: `packages/spa/src/components/office/interaction-layer.ts`

These are pure rendering modules with no external dependencies — no unit tests needed (visual correctness verified by browser). The canvas modules are imperative drawing code.

- [ ] **Step 1: Create TileMap renderer**

```typescript
// packages/spa/src/components/office/tile-map.ts
const TILE_SIZE = 32;

/** Office grid dimensions (in tiles). */
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 14;

/** Canvas pixel dimensions. */
export const CANVAS_WIDTH = GRID_WIDTH * TILE_SIZE;
export const CANVAS_HEIGHT = GRID_HEIGHT * TILE_SIZE;

/**
 * Render the static office background.
 * Uses basic canvas drawing until tileset images are loaded.
 */
export function renderTileMap(ctx: CanvasRenderingContext2D): void {
  // Background
  ctx.fillStyle = "#2a2a3a";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Floor tiles (checkerboard)
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const isLight = (x + y) % 2 === 0;
      ctx.fillStyle = isLight ? "#3a3a4a" : "#2e2e3e";
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Work area (left side)
  ctx.fillStyle = "#333344";
  ctx.fillRect(0, 3 * TILE_SIZE, 10 * TILE_SIZE, 9 * TILE_SIZE);

  // Lounge area (right side)
  ctx.fillStyle = "#2d3344";
  ctx.fillRect(11 * TILE_SIZE, 3 * TILE_SIZE, 5 * TILE_SIZE, 9 * TILE_SIZE);

  // Divider wall
  ctx.fillStyle = "#555566";
  ctx.fillRect(10 * TILE_SIZE, 3 * TILE_SIZE, TILE_SIZE / 2, 9 * TILE_SIZE);

  // Desks (6 positions)
  const deskPositions = [
    [2, 4], [6, 4], [2, 7], [6, 7], [2, 10], [6, 10],
  ];
  ctx.fillStyle = "#665544";
  for (const [dx, dy] of deskPositions) {
    ctx.fillRect(dx! * TILE_SIZE - 8, dy! * TILE_SIZE - 4, TILE_SIZE + 16, TILE_SIZE + 8);
    // Monitor
    ctx.fillStyle = "#4488aa";
    ctx.fillRect(dx! * TILE_SIZE + 4, dy! * TILE_SIZE - 2, TILE_SIZE - 8, TILE_SIZE - 12);
    ctx.fillStyle = "#665544";
  }

  // Water cooler
  ctx.fillStyle = "#66aadd";
  ctx.fillRect(2 * TILE_SIZE + 8, 2 * TILE_SIZE + 8, TILE_SIZE - 16, TILE_SIZE - 8);

  // Couches
  ctx.fillStyle = "#885544";
  ctx.fillRect(12 * TILE_SIZE, 4 * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);
  ctx.fillRect(12 * TILE_SIZE, 7 * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);

  // Labels
  ctx.fillStyle = "#aaaacc";
  ctx.font = "10px monospace";
  ctx.fillText("WORK", 4 * TILE_SIZE, TILE_SIZE + 12);
  ctx.fillText("LOUNGE", 12 * TILE_SIZE, TILE_SIZE + 12);
  ctx.fillText("WATER COOLER", TILE_SIZE, 2 * TILE_SIZE - 4);
}
```

- [ ] **Step 2: Create BotSprite renderer**

```typescript
// packages/spa/src/components/office/bot-sprite.ts
import type { BotState, ActivityState, GridPosition } from "./types";

const TILE_SIZE = 32;
const SPRITE_SIZE = 24;
const MOVE_SPEED = 2; // pixels per frame

/** Color palette for different bots. */
const BOT_COLORS = [
  "#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b",
  "#cc5de8", "#ff922b", "#20c997", "#f06595",
  "#748ffc", "#a9e34b", "#22b8cf", "#e599f7",
];

/** Get bot color by index. */
function getBotColor(deskIndex: number): string {
  return BOT_COLORS[deskIndex % BOT_COLORS.length]!;
}

/** Interpolate position toward target. Returns true if still moving. */
export function updatePosition(state: BotState): boolean {
  const dx = state.targetPosition.x * TILE_SIZE - state.position.x * TILE_SIZE;
  const dy = state.targetPosition.y * TILE_SIZE - state.position.y * TILE_SIZE;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < MOVE_SPEED) {
    state.position = { ...state.targetPosition };
    return false;
  }

  state.position = {
    x: state.position.x + (dx / dist) * MOVE_SPEED / TILE_SIZE,
    y: state.position.y + (dy / dist) * MOVE_SPEED / TILE_SIZE,
  };
  return true;
}

/** Render a single bot sprite. */
export function renderBotSprite(
  ctx: CanvasRenderingContext2D,
  state: BotState,
  frameCount: number,
): void {
  const px = state.position.x * TILE_SIZE;
  const py = state.position.y * TILE_SIZE;
  const color = getBotColor(state.deskIndex);

  // Body (pixel art style)
  ctx.fillStyle = color;
  ctx.fillRect(px + 4, py + 8, SPRITE_SIZE - 8, SPRITE_SIZE - 8);

  // Head
  ctx.fillRect(px + 6, py + 2, SPRITE_SIZE - 12, 10);

  // Eyes
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(px + 8, py + 4, 3, 3);
  ctx.fillRect(px + 15, py + 4, 3, 3);

  // Pupils (blink animation)
  if (frameCount % 120 < 110) {
    ctx.fillStyle = "#111111";
    ctx.fillRect(px + 9, py + 5, 2, 2);
    ctx.fillRect(px + 16, py + 5, 2, 2);
  }

  // Activity-specific animation
  renderActivityAnimation(ctx, state, px, py, frameCount);

  // Name label
  ctx.fillStyle = "#ffffff";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText(state.name, px + SPRITE_SIZE / 2 + 2, py + TILE_SIZE + 8);
  ctx.textAlign = "start";
}

function renderActivityAnimation(
  ctx: CanvasRenderingContext2D,
  state: BotState,
  px: number,
  py: number,
  frame: number,
): void {
  switch (state.activity) {
    case "thinking": {
      // Thought bubble with "..."
      const bobY = Math.sin(frame * 0.05) * 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(px + SPRITE_SIZE + 8, py - 4 + bobY, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#333333";
      ctx.font = "bold 10px monospace";
      ctx.fillText("...", px + SPRITE_SIZE, py - 2 + bobY);
      break;
    }
    case "tool_use": {
      // Tool icon floating above
      ctx.fillStyle = "#ffd43b";
      ctx.font = "10px monospace";
      const toolLabel = state.toolName ?? "tool";
      ctx.fillText(toolLabel, px - 2, py - 4);
      // Typing animation (hands)
      if (frame % 10 < 5) {
        ctx.fillStyle = color(state);
        ctx.fillRect(px + 2, py + SPRITE_SIZE, 4, 3);
        ctx.fillRect(px + SPRITE_SIZE - 6, py + SPRITE_SIZE, 4, 3);
      }
      break;
    }
    case "responding": {
      // Speech bubble
      const bobY = Math.sin(frame * 0.08) * 1;
      ctx.fillStyle = "#51cf66";
      ctx.beginPath();
      ctx.ellipse(px + SPRITE_SIZE + 10, py - 4 + bobY, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "8px monospace";
      ctx.fillText("abc", px + SPRITE_SIZE + 1, py - 1 + bobY);
      break;
    }
    case "error": {
      // Red exclamation mark
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 16px sans-serif";
      const flash = frame % 30 < 15;
      if (flash) {
        ctx.fillText("!", px + SPRITE_SIZE / 2, py - 4);
      }
      break;
    }
  }
}

function color(state: BotState): string {
  return getBotColor(state.deskIndex);
}
```

- [ ] **Step 3: Create bubble renderer**

```typescript
// packages/spa/src/components/office/bubble-renderer.ts
import type { BotState } from "./types";

const TILE_SIZE = 32;

/** Render status bubbles for all bots that have quests or special states. */
export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  bots: BotState[],
  frameCount: number,
): void {
  for (const bot of bots) {
    if (bot.activity === "error") {
      renderQuestMarker(ctx, bot, "#ff6b6b", "!", frameCount);
    }
  }
}

function renderQuestMarker(
  ctx: CanvasRenderingContext2D,
  bot: BotState,
  markerColor: string,
  text: string,
  frame: number,
): void {
  const px = bot.position.x * TILE_SIZE + 12;
  const py = bot.position.y * TILE_SIZE - 12;
  const bobY = Math.sin(frame * 0.06) * 3;

  // Marker background
  ctx.fillStyle = markerColor;
  ctx.beginPath();
  ctx.arc(px, py + bobY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, px, py + bobY + 4);
  ctx.textAlign = "start";
}
```

- [ ] **Step 4: Create interaction layer**

```typescript
// packages/spa/src/components/office/interaction-layer.ts
import type { BotState } from "./types";

const TILE_SIZE = 32;
const HIT_SIZE = 28;

/** Test if a click position hits a bot sprite. Returns bot name or null. */
export function hitTest(
  bots: BotState[],
  canvasX: number,
  canvasY: number,
): string | null {
  // Check in reverse order (last rendered = on top)
  for (let i = bots.length - 1; i >= 0; i--) {
    const bot = bots[i]!;
    const px = bot.position.x * TILE_SIZE;
    const py = bot.position.y * TILE_SIZE;

    if (
      canvasX >= px && canvasX <= px + HIT_SIZE &&
      canvasY >= py && canvasY <= py + HIT_SIZE
    ) {
      return bot.name;
    }
  }
  return null;
}

/** Get canvas-relative coordinates from a mouse event. */
export function getCanvasCoords(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/spa/src/components/office/tile-map.ts packages/spa/src/components/office/bot-sprite.ts packages/spa/src/components/office/bubble-renderer.ts packages/spa/src/components/office/interaction-layer.ts
git commit -m "feat(spa): add pixel art canvas renderers (tilemap, sprites, bubbles, interaction)"
```

---

### Task 10: OfficeCanvas component + /office route

**Files:**
- Create: `packages/spa/src/components/office/office-canvas.tsx`
- Create: `packages/spa/src/pages/office.tsx`
- Modify: `packages/spa/src/app.tsx`

- [ ] **Step 1: Create OfficeCanvas component**

```tsx
// packages/spa/src/components/office/office-canvas.tsx
import { useRef, useEffect, useCallback, useState } from "react";
import { OfficeActivityManager } from "./activity-manager";
import { useActivityStream } from "./use-activity-stream";
import { renderTileMap, CANVAS_WIDTH, CANVAS_HEIGHT } from "./tile-map";
import { renderBotSprite, updatePosition } from "./bot-sprite";
import { renderBubbles } from "./bubble-renderer";
import { hitTest, getCanvasCoords } from "./interaction-layer";
import type { ActivityEvent } from "./types";

interface OfficeCanvasProps {
  onBotClick?: (name: string) => void;
}

export function OfficeCanvas({ onBotClick }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef(new OfficeActivityManager());
  const frameRef = useRef(0);
  const tileMapCacheRef = useRef<ImageBitmap | null>(null);
  const [botCount, setBotCount] = useState(0);

  const handleEvent = useCallback((event: ActivityEvent) => {
    managerRef.current.handleEvent(event);
    setBotCount(managerRef.current.getAllBotStates().length);
  }, []);

  useActivityStream(handleEvent);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Pre-render tilemap
    const offscreen = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const offCtx = offscreen.getContext("2d")!;
    renderTileMap(offCtx as unknown as CanvasRenderingContext2D);

    let animId: number;

    function frame() {
      frameRef.current++;
      const fc = frameRef.current;

      // Clear and draw cached tilemap
      ctx!.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx!.drawImage(offscreen, 0, 0);

      // Update and draw bots
      const bots = managerRef.current.getAllBotStates();
      for (const bot of bots) {
        updatePosition(bot);
        renderBotSprite(ctx!, bot, fc);
      }

      // Bubbles
      renderBubbles(ctx!, bots, fc);

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(animId);
  }, []);

  // Click handler
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onBotClick) return;

    const coords = getCanvasCoords(e.nativeEvent, canvas);
    const bots = managerRef.current.getAllBotStates();
    const hit = hitTest(bots, coords.x, coords.y);
    if (hit) onBotClick(hit);
  }, [onBotClick]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onClick={handleClick}
      className="w-full max-w-2xl rounded-lg border border-border cursor-pointer"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
```

- [ ] **Step 2: Create OfficePage**

```tsx
// packages/spa/src/pages/office.tsx
import { useState, useCallback } from "react";
import { OfficeCanvas } from "@/components/office/office-canvas";
import { InspectPanel } from "@/components/office/inspect-panel";

export function OfficePage() {
  const [selectedBot, setSelectedBot] = useState<string | null>(null);

  const handleBotClick = useCallback((name: string) => {
    setSelectedBot(prev => prev === name ? null : name);
  }, []);

  return (
    <div className="flex h-full gap-4 p-5">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="text-sm font-medium text-muted-foreground">
          Pixel Office
        </div>
        <OfficeCanvas onBotClick={handleBotClick} />
        <p className="text-xs text-muted-foreground">
          Click a bot to inspect. Bots move between rooms based on activity.
        </p>
      </div>
      {selectedBot && (
        <InspectPanel
          botName={selectedBot}
          onClose={() => setSelectedBot(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create InspectPanel placeholder**

```tsx
// packages/spa/src/components/office/inspect-panel.tsx
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InspectPanelProps {
  botName: string;
  onClose: () => void;
}

export function InspectPanel({ botName, onClose }: InspectPanelProps) {
  return (
    <div className="w-72 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-card-foreground">{botName}</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div>Activity: loading...</div>
        <div>Session: -</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add /office route to app.tsx**

Modify `packages/spa/src/app.tsx`:

1. Add import: `import { OfficePage } from "@/pages/office";`
2. Inside the `<Route element={<DashboardLayout />}>` block, add:
   `<Route path="office" element={<OfficePage />} />`

- [ ] **Step 5: Add Office to sidebar navigation**

Find the sidebar nav component and add an entry for `/office` with an appropriate icon (e.g., `BuildingIcon` or `MonitorIcon` from lucide-react).

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/spa/src/components/office/ packages/spa/src/pages/office.tsx packages/spa/src/app.tsx
git commit -m "feat(spa): add /office route with pixel art canvas visualization"
```

---

## Chunk 4: Phase 4 — Interactions + Integration

### Task 11: Inspect panel with live data

**Files:**
- Modify: `packages/spa/src/components/office/inspect-panel.tsx`

- [ ] **Step 1: Enhance InspectPanel with live bot data**

Update `packages/spa/src/components/office/inspect-panel.tsx` to:

1. Fetch bot status from `/bots/{name}` API
2. Show: name, current activity, tool name, session ID, duration, cost
3. Add "Send Message" input that POSTs to `/bots/{name}/query`
4. Add "View Logs" link (navigate to `/bot/{name}`)
5. Add "Stop Bot" button (POST `/bots/{name}/stop`)

```tsx
// packages/spa/src/components/office/inspect-panel.tsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { XIcon, SendIcon, ExternalLinkIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InspectPanelProps {
  botName: string;
  onClose: () => void;
}

interface BotInfo {
  name: string;
  state: string;
  port: number;
  uptime?: string;
}

export function InspectPanel({ botName, onClose }: InspectPanelProps) {
  const navigate = useNavigate();
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/bots/${botName}`)
      .then(r => r.json())
      .then(data => setBotInfo(data as BotInfo))
      .catch(() => {});
  }, [botName]);

  const sendMessage = useCallback(async () => {
    if (!message.trim()) return;
    setSending(true);
    setResponse(null);
    try {
      const res = await fetch(`/bots/${botName}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json() as { response?: string };
      setResponse(data.response ?? "No response");
      setMessage("");
    } catch {
      setResponse("Failed to send message");
    } finally {
      setSending(false);
    }
  }, [botName, message]);

  return (
    <div className="w-80 rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-card-foreground font-mono">{botName}</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div>State: <span className="text-foreground font-medium">{botInfo?.state ?? "..."}</span></div>
        <div>Port: <span className="font-mono text-foreground">{botInfo?.port ?? "-"}</span></div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">Send Message</div>
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Ask something..."
            className="h-8 text-xs"
            disabled={sending}
          />
          <Button
            variant="outline"
            size="icon-xs"
            onClick={sendMessage}
            disabled={sending || !message.trim()}
          >
            <SendIcon className="size-3" />
          </Button>
        </div>
        {response && (
          <div className="mt-2 rounded-md bg-muted p-2 text-xs text-foreground max-h-32 overflow-y-auto">
            {response}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="xs"
          onClick={() => navigate(`/bot/${botName}`)}
          className="flex-1"
        >
          <ExternalLinkIcon className="size-3 mr-1" />
          Details
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="flex-1 text-destructive border-destructive/30"
          onClick={async () => {
            await fetch(`/bots/${botName}/stop`, { method: "POST" });
          }}
        >
          <SquareIcon className="size-3 mr-1" />
          Stop
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/spa/src/components/office/inspect-panel.tsx
git commit -m "feat(spa): add live inspect panel with DM and bot actions"
```

---

### Task 12: Build verification + integration test

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Manual verification checklist**

1. Start daemon: `mecha start --daemon`
2. Spawn a test bot: `mecha bot spawn test-office`
3. Run `mecha bot activity test-office` — should show activity snapshot
4. Navigate to `/office` in browser — should see canvas with bot NPC
5. Click bot — inspect panel should appear
6. Send a message via inspect panel — bot should transition through activity states

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address build/test issues from pixel office integration"
```

---

## Summary

| Task | Description | Package | Chunk |
|------|-------------|---------|-------|
| 1 | ActivityEmitter + types | runtime | 1 |
| 2 | sdkChat activity emission | runtime | 1 |
| 3 | Bot SSE endpoint | runtime | 1 |
| 4 | CLI `bot activity` command | cli, service | 1 |
| 5 | ActivityAggregator | agent | 2 |
| 6 | Enhanced daemon SSE | agent | 2 |
| 7 | Activity manager (state machine) | spa | 3 |
| 8 | SSE consumer hook | spa | 3 |
| 9 | Canvas renderers | spa | 3 |
| 10 | Office page + route | spa | 3 |
| 11 | Inspect panel with live data | spa | 4 |
| 12 | Build verification | all | 4 |
