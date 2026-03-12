# Pixel Office Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pixel-art office visualization tab to the bot dashboard that shows bot activity in real time using Phaser 3.

**Architecture:** React owns tab routing, overlays, SSE data, and the bridge state object. Phaser owns tilemap rendering, character animation, and furniture click zones. A shared `OfficeBridge` ref connects them — React writes state from SSE/polling, Phaser reads it every frame. Phaser is dynamically imported so non-Office users pay zero bundle cost.

**Tech Stack:** Phaser 3.90.0 (dynamic import), React 19, TypeScript, Vite 6, Vitest, Hono (server)

**Spec:** `docs/superpowers/specs/2026-03-13-pixel-office-design.md`

---

## File Structure

### Server-side (new/modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `agent/character-config.ts` | Create | Read/write `$MECHA_STATE_DIR/character.json` |
| `agent/office-events.ts` | Create | Shared EventEmitter for tool/subagent SSE events |
| `agent/activity.ts` | Modify | (no changes needed — "error" state already exists) |
| `agent/server.ts` | Modify | Wire officeEvents, enhance SSE stream, add character endpoints, error hold, filtered logs |
| `agent/server.types.ts` | Modify | Add `id` field to ContentBlock type |
| `agent/paths.ts` | Modify | Add `characterConfig` path |

### Client-side (new/modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `agent/dashboard/src/views/office/office-bridge.ts` | Create | OfficeBridge type + createBridge factory |
| `agent/dashboard/src/views/office/zones.ts` | Create | Zone definitions (position, furniture, hitbox) |
| `agent/dashboard/src/views/office/routes.ts` | Create | Precomputed 30-pair route table |
| `agent/dashboard/src/views/office/asset-manifest.ts` | Create | Logical name → file path map |
| `agent/dashboard/src/views/office/tilemap-data.ts` | Create | 16×14 tile index array |
| `agent/dashboard/src/views/office/office-scene.ts` | Create | Phaser Scene: preload, create, update |
| `agent/dashboard/src/views/office/character.ts` | Create | Character compositing + animation state machine |
| `agent/dashboard/src/views/office/ambient.ts` | Create | Clock, coffee, plant, window light |
| `agent/dashboard/src/views/office/subagent-clones.ts` | Create | Clone sprite manager |
| `agent/dashboard/src/views/office/office-status.ts` | Create | SSE subscription + polling → writes bridge |
| `agent/dashboard/src/views/office/office-view.tsx` | Create | React wrapper: lazy Phaser, overlays, status bar |
| `agent/dashboard/src/views/office/character-editor.tsx` | Create | Character customization modal |
| `agent/dashboard/src/app.tsx` | Modify | Add "Office" tab + icon |
| `agent/dashboard/src/lib/api.ts` | Modify | Add botSSE helper |
| `agent/dashboard/scripts/mock-api.ts` | Modify | Add office-related mock endpoints |

### Tests

| File | Tests |
|------|-------|
| `agent/character-config.test.ts` | Read/write/validate character config |
| `agent/dashboard/src/views/office/zones.test.ts` | Zone mapping (activity→zone) |
| `agent/dashboard/src/views/office/routes.test.ts` | Route table completeness + valid coords |
| `agent/dashboard/src/views/office/office-bridge.test.ts` | Bridge creation + revision increment |
| `agent/dashboard/src/views/office/asset-manifest.test.ts` | All paths resolve to existing files |
| `agent/dashboard/src/views/office/ambient.test.ts` | Plant state, coffee counter, window tint |

---

## Chunk 1: Server-Side Foundation

### Task 1: Character Config Module

**Files:**
- Create: `agent/character-config.ts`
- Create: `agent/character-config.test.ts`
- Modify: `agent/paths.ts:1-11`

- [ ] **Step 1: Add characterConfig to PATHS**

In `agent/paths.ts`, add `characterConfig` path:

```typescript
const STATE_DIR = process.env.MECHA_STATE_DIR ?? "/state";

export const PATHS = {
  state: STATE_DIR,
  sessions: `${STATE_DIR}/sessions`,
  sessionIndex: `${STATE_DIR}/sessions/index.json`,
  logs: `${STATE_DIR}/logs`,
  eventsLog: `${STATE_DIR}/logs/events.jsonl`,
  scheduleState: `${STATE_DIR}/logs/schedule-state.json`,
  costs: `${STATE_DIR}/costs.json`,
  characterConfig: `${STATE_DIR}/character.json`,  // NEW
} as const;
```

- [ ] **Step 2: Write failing tests for character-config**

Create `agent/character-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// We'll set MECHA_STATE_DIR before importing
const TEST_DIR = join(import.meta.dirname, ".test-state-char");

describe("character-config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MECHA_STATE_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.MECHA_STATE_DIR;
  });

  it("returns defaults when file missing", async () => {
    // Dynamic import to pick up env change
    const { readCharacter } = await import("./character-config.js");
    const config = readCharacter();
    expect(config).toEqual({ skin: 0, hair: 0, outfit: "outfit1" });
  });

  it("reads saved config", async () => {
    writeFileSync(join(TEST_DIR, "character.json"), JSON.stringify({ skin: 3, hair: 5, outfit: "suit2" }));
    const { readCharacter } = await import("./character-config.js");
    const config = readCharacter();
    expect(config).toEqual({ skin: 3, hair: 5, outfit: "suit2" });
  });

  it("validates and rejects invalid skin", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 6, hair: 0, outfit: "outfit1" })).toBe(false);
    expect(validateCharacter({ skin: -1, hair: 0, outfit: "outfit1" })).toBe(false);
  });

  it("validates and rejects invalid hair", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 0, hair: 8, outfit: "outfit1" })).toBe(false);
  });

  it("validates and rejects invalid outfit", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 0, hair: 0, outfit: "tuxedo1" })).toBe(false);
  });

  it("accepts valid configs", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 5, hair: 7, outfit: "outfit6" })).toBe(true);
    expect(validateCharacter({ skin: 0, hair: 0, outfit: "suit4" })).toBe(true);
  });

  it("writes config to disk", async () => {
    const { writeCharacter } = await import("./character-config.js");
    writeCharacter({ skin: 2, hair: 4, outfit: "suit1" });
    const raw = readFileSync(join(TEST_DIR, "character.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ skin: 2, hair: 4, outfit: "suit1" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd agent && npx vitest run character-config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement character-config.ts**

Create `agent/character-config.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "./paths.js";

export interface CharacterConfig {
  skin: number;
  hair: number;
  outfit: string;
}

const DEFAULTS: CharacterConfig = { skin: 0, hair: 0, outfit: "outfit1" };
const OUTFIT_RE = /^(outfit[1-6]|suit[1-4])$/;

export function validateCharacter(c: unknown): c is CharacterConfig {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  if (typeof obj.skin !== "number" || !Number.isInteger(obj.skin) || obj.skin < 0 || obj.skin > 5) return false;
  if (typeof obj.hair !== "number" || !Number.isInteger(obj.hair) || obj.hair < 0 || obj.hair > 7) return false;
  if (typeof obj.outfit !== "string" || !OUTFIT_RE.test(obj.outfit)) return false;
  return true;
}

export function readCharacter(): CharacterConfig {
  try {
    const raw = readFileSync(PATHS.characterConfig, "utf-8");
    const parsed = JSON.parse(raw);
    return validateCharacter(parsed) ? parsed : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeCharacter(config: CharacterConfig): void {
  mkdirSync(dirname(PATHS.characterConfig), { recursive: true });
  writeFileSync(PATHS.characterConfig, JSON.stringify(config, null, 2));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && npx vitest run character-config.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add agent/paths.ts agent/character-config.ts agent/character-config.test.ts
git commit -m "feat(office): add character config read/write/validate module"
```

---

### Task 2: Office Events Emitter

**Files:**
- Create: `agent/office-events.ts`

- [ ] **Step 1: Create office-events.ts**

```typescript
import { EventEmitter } from "node:events";

/** Shared emitter for tool + subagent events consumed by the SSE stream. */
export const officeEvents = new EventEmitter();
officeEvents.setMaxListeners(50); // Multiple SSE clients

export interface ToolEvent {
  name: string;
  context: string;
}

export interface SubagentEvent {
  action: "spawn" | "complete";
  id: string;
  type?: string;
  description?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/office-events.ts
git commit -m "feat(office): add shared officeEvents emitter for SSE tool/subagent events"
```

---

### Task 3: Enhance Server — SSE Stream, Error Hold, Character Endpoints, Filtered Logs

**Files:**
- Modify: `agent/server.ts`

This is the largest server change. We modify `server.ts` and `server.types.ts`.

- [ ] **Step 0: Add `id` to ContentBlock in server.types.ts**

The SDK's tool_use content blocks include an `id` field (the tool_use_id) but our `ContentBlock` type doesn't have it. Add it:

In `agent/server.types.ts`, modify the `ContentBlock` interface:

```typescript
export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;  // tool_use_id — present on tool_use blocks
}
```

- [ ] **Step 1: Add imports for office modules**

At the top of `agent/server.ts`, after existing imports (line 20), add:

```typescript
import { officeEvents } from "./office-events.js";
import { readCharacter, writeCharacter, validateCharacter } from "./character-config.js";
```

- [ ] **Step 2: Emit tool/subagent events from runClaude onEvent**

In `server.ts`, the `runClaude` function iterates SDK events (lines 135-171). Enhance the `tool_use` handling at line 155-157 to also emit on `officeEvents`:

```typescript
          if (block.type === "tool_use") {
            onEvent?.({ type: "tool_use", data: { tool: block.name, input: block.input, toolUseId: block.id } });
            // Emit for office SSE stream
            const toolContext = (await import("../agent/dashboard/src/lib/format.js").catch(() => null))
              ? "" : ""; // formatToolLabel is client-side, inline a simple version:
            officeEvents.emit("tool", { name: block.name, context: formatToolContext(block.name, block.input) });
            if (block.name === "Agent") {
              const input = block.input as Record<string, unknown> | undefined;
              officeEvents.emit("subagent", {
                action: "spawn",
                id: block.id,
                type: String(input?.subagent_type ?? "general"),
                description: String(input?.description ?? ""),
              });
            }
          }
```

Actually, let's keep it simpler. Add a helper function near the top of `server.ts` and modify the existing tool_use block:

After the `activityStateForSource` function (~line 192), add:

```typescript
function formatToolContext(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Read": case "Edit": case "Write": return String(obj.file_path ?? "");
    case "Bash": return String(obj.command ?? "").slice(0, 80);
    case "Grep": case "Glob": return String(obj.pattern ?? "");
    case "WebSearch": return String(obj.query ?? "");
    default: return "";
  }
}
```

Then in the `runClaude` function, replace lines 155-157:

```typescript
          if (block.type === "tool_use") {
            onEvent?.({ type: "tool_use", data: { tool: block.name, input: block.input } });
            // Office SSE: emit tool event
            officeEvents.emit("tool", { name: block.name, context: formatToolContext(block.name, block.input) });
            // Office SSE: detect subagent spawn
            if (block.name === "Agent") {
              const agentInput = block.input as Record<string, unknown> | undefined;
              officeEvents.emit("subagent", {
                action: "spawn",
                id: block.id ?? "",
                type: String(agentInput?.subagent_type ?? "general"),
                description: String(agentInput?.description ?? ""),
              });
            }
          }
```

Also handle tool_result for subagent completion. After the existing `result` event handling (~line 170), add a new check for tool_result events. The SDK doesn't emit `tool_result` as a separate event type in the stream — tool results come as `user` type messages with `tool_result` content blocks. So we detect subagent completion when the next assistant message arrives after a subagent was spawned. Instead, we can emit the `subagent complete` event when the `result` event fires — but that only fires at the very end.

A simpler approach: emit subagent complete when we see a `tool_result` content block in user messages. The SDK iterates these as events. Check the event types:

Actually, looking at the SDK event flow, `tool_result` content blocks appear in `user` type events. Let's just add detection there. Add after the assistant event handling block (~after line 160):

```typescript
    // Detect tool_result for subagent completion
    if (event.type === "user") {
      const userEvent = event as { type: string; message?: { content?: Array<{ type: string; tool_use_id?: string }> } };
      if (userEvent.message?.content) {
        for (const block of userEvent.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            officeEvents.emit("subagent", { action: "complete", id: block.tool_use_id });
          }
        }
      }
    }
```

Note: This emits "complete" for ALL tool results, not just Agent ones. That's fine — Phaser only tracks IDs it spawned.

- [ ] **Step 3: Add error state hold in handlePrompt and prompt route**

In `handlePrompt` (~line 256), change the `finally` block from:

```typescript
    } finally {
      activity.transition("idle");
      release();
    }
```

to:

```typescript
    } finally {
      if (activity.getState() === "error" || !sessions.getActiveTask()?.success === false) {
        // Hold error state for 5s so the office can animate it
        activity.transition("error");
        setTimeout(() => {
          if (activity.getState() === "error") activity.transition("idle");
        }, 5000);
      } else {
        activity.transition("idle");
      }
      release();
    }
```

Wait, the logic is simpler. We want error state when the task failed. Let's look at the actual flow — `sessions.markError()` is called in the catch block, and the finally always transitions to idle. Change the catch + finally in `handlePrompt`:

```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sessions.markError(message);
      activity.transition("error");
      setTimeout(() => {
        if (activity.getState() === "error") activity.transition("idle");
      }, 5000);
      throw err;
    } finally {
      if (activity.getState() !== "error") {
        activity.transition("idle");
      }
      release();
    }
```

Apply the same pattern in the POST `/prompt` route's catch/finally (lines 336-345):

```typescript
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Prompt stream error", { error: message });
        sessions.markError(message);
        activity.transition("error");
        setTimeout(() => {
          if (activity.getState() === "error") activity.transition("idle");
        }, 5000);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Internal error processing request" }) });
      } finally {
        if (activity.getState() !== "error") {
          activity.transition("idle");
        }
        release();
      }
```

- [ ] **Step 4: Enhance /api/status/stream with snapshot, tool/subagent events, heartbeat**

Replace the existing `/api/status/stream` handler (lines 405-421) with:

```typescript
  app.get("/api/status/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial snapshot on connect
      const snapshot = {
        activity: activity.getState(),
        talkingTo: activity.getTalkingTo(),
        lastActive: activity.getLastActive(),
      };
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });

      // Subscribe to state changes
      const onStateChange = (data: unknown) => {
        stream.writeSSE({ event: "state", data: JSON.stringify(data) }).catch(() => {});
      };
      activity.on("change", onStateChange);

      // Subscribe to tool events
      const onTool = (data: unknown) => {
        stream.writeSSE({ event: "tool", data: JSON.stringify(data) }).catch(() => {});
      };
      officeEvents.on("tool", onTool);

      // Subscribe to subagent events
      const onSubagent = (data: unknown) => {
        stream.writeSSE({ event: "subagent", data: JSON.stringify(data) }).catch(() => {});
      };
      officeEvents.on("subagent", onSubagent);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => {});
      }, 30_000);

      // Keep alive until client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          activity.off("change", onStateChange);
          officeEvents.off("tool", onTool);
          officeEvents.off("subagent", onSubagent);
          clearInterval(heartbeat);
          resolve();
        });
      });
    });
  });
```

- [ ] **Step 5: Enhance /api/status with current_session_id**

Modify the `/api/status` handler (lines 392-403). Change the return to include `current_session_id`:

```typescript
  app.get("/api/status", (c) => {
    const activeTask = sessions.getActiveTask();
    return c.json({
      name: config.name,
      state: activity.getState(),
      model: config.model,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      current_task: activeTask?.id ?? null,
      current_session_id: activeTask?.session_id ?? null,
      talking_to: activity.getTalkingTo(),
      last_active: activity.getLastActive(),
    });
  });
```

- [ ] **Step 6: Add ?source= filter to /api/logs**

Modify the `/api/logs` handler (lines 423-427):

```typescript
  app.get("/api/logs", (c) => {
    const rawLimit = parseInt(c.req.query("limit") ?? "100", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const source = c.req.query("source");
    let events = readEvents(limit);
    if (source) {
      events = events.filter((e) => e.type === source || e.source === source);
    }
    return c.json(events);
  });
```

- [ ] **Step 7: Add character config endpoints**

Before the dashboard routes line (`app.route("/", createDashboardRoutes(BOT_TOKEN))`, line 482), add:

```typescript
  // Character appearance config
  app.get("/api/config/character", (c) => {
    return c.json(readCharacter());
  });

  app.post("/api/config/character", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validateCharacter(body)) {
      return c.json({ error: "Invalid character config. skin: 0-5, hair: 0-7, outfit: outfit1-6 or suit1-4" }, 400);
    }
    writeCharacter(body);
    return c.json({ ok: true });
  });
```

- [ ] **Step 8: Commit**

```bash
git add agent/server.ts agent/server.types.ts
git commit -m "feat(office): enhance SSE stream with tool/subagent events, error hold, character endpoints, filtered logs"
```

---

## Chunk 2: Client-Side Pure Logic Modules

### Task 4: SSE Helper in api.ts

**Files:**
- Modify: `agent/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add botSSE helper**

Append to `agent/dashboard/src/lib/api.ts`:

```typescript
export interface SSECallbacks {
  onEvent: (event: string, data: string) => void;
  onError?: (err: Event) => void;
}

export function botSSE(path: string, callbacks: SSECallbacks): EventSource {
  const es = new EventSource(botUrl(path));
  // Listen for named events — EventSource requires explicit listeners per event type
  // We use the generic "message" handler plus specific event types
  for (const eventType of ["snapshot", "state", "tool", "subagent", "heartbeat"]) {
    es.addEventListener(eventType, (e: MessageEvent) => {
      callbacks.onEvent(eventType, e.data);
    });
  }
  es.onerror = (e) => {
    callbacks.onError?.(e);
  };
  return es;
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/lib/api.ts
git commit -m "feat(office): add botSSE helper for named EventSource events"
```

---

### Task 5: Office Bridge Type

**Files:**
- Create: `agent/dashboard/src/views/office/office-bridge.ts`
- Create: `agent/dashboard/src/views/office/office-bridge.test.ts`

- [ ] **Step 1: Write failing test**

Create `agent/dashboard/src/views/office/office-bridge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createBridge } from "./office-bridge";
import type { OfficeBridge } from "./office-bridge";

describe("OfficeBridge", () => {
  it("creates with default state", () => {
    const bridge = createBridge();
    expect(bridge.revision).toBe(0);
    expect(bridge.state.activity).toBe("idle");
    expect(bridge.state.subagents).toEqual([]);
    expect(bridge.state.costToday).toBe(0);
    expect(bridge.character.skin).toBe(0);
    expect(bridge.onFurnitureClick).toBeNull();
  });

  it("incrementRevision bumps revision", () => {
    const bridge = createBridge();
    expect(bridge.revision).toBe(0);
    bridge.revision++;
    expect(bridge.revision).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent/dashboard && npx vitest run src/views/office/office-bridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement office-bridge.ts**

Create `agent/dashboard/src/views/office/office-bridge.ts`:

```typescript
export type ActivityState = "idle" | "thinking" | "calling" | "scheduled" | "webhook" | "error";
export type ClickableItem = "computer" | "phone" | "printer" | "server" | "door" | "character";

export interface OfficeBridge {
  revision: number;
  state: {
    activity: ActivityState;
    talkingTo: string | null;
    currentTool: string | null;
    currentToolContext: string | null;
    subagents: { id: string; type: string; description: string }[];
    currentSessionId: string | null;
    taskStartedAt: string | null;
    costToday: number;
    consecutiveErrors: number;
    scheduleNextRunAt: string | null;
    ptyClientsConnected: number;
    idleSinceSec: number;
  };
  character: {
    skin: number;
    hair: number;
    outfit: string;
  };
  onFurnitureClick: ((item: ClickableItem) => void) | null;
}

export function createBridge(): OfficeBridge {
  return {
    revision: 0,
    state: {
      activity: "idle",
      talkingTo: null,
      currentTool: null,
      currentToolContext: null,
      subagents: [],
      currentSessionId: null,
      taskStartedAt: null,
      costToday: 0,
      consecutiveErrors: 0,
      scheduleNextRunAt: null,
      ptyClientsConnected: 0,
      idleSinceSec: 0,
    },
    character: { skin: 0, hair: 0, outfit: "outfit1" },
    onFurnitureClick: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent/dashboard && npx vitest run src/views/office/office-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/dashboard/src/views/office/office-bridge.ts agent/dashboard/src/views/office/office-bridge.test.ts
git commit -m "feat(office): add OfficeBridge type and factory"
```

---

### Task 6: Zone Definitions

**Files:**
- Create: `agent/dashboard/src/views/office/zones.ts`
- Create: `agent/dashboard/src/views/office/zones.test.ts`

- [ ] **Step 1: Write failing test**

Create `agent/dashboard/src/views/office/zones.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ZONES, zoneForActivity } from "./zones";
import type { ActivityState } from "./office-bridge";

describe("zones", () => {
  it("maps all activity states to a zone", () => {
    const activities: ActivityState[] = ["idle", "thinking", "calling", "scheduled", "webhook", "error"];
    for (const a of activities) {
      const zone = zoneForActivity(a);
      expect(zone).toBeDefined();
      expect(ZONES[zone]).toBeDefined();
    }
  });

  it("maps thinking→desk, idle→sofa, calling→phone", () => {
    expect(zoneForActivity("thinking")).toBe("desk");
    expect(zoneForActivity("idle")).toBe("sofa");
    expect(zoneForActivity("calling")).toBe("phone");
    expect(zoneForActivity("scheduled")).toBe("printer");
    expect(zoneForActivity("error")).toBe("server");
    expect(zoneForActivity("webhook")).toBe("door");
  });

  it("all zones have valid tile positions", () => {
    for (const [id, zone] of Object.entries(ZONES)) {
      expect(zone.tileX).toBeGreaterThanOrEqual(0);
      expect(zone.tileX).toBeLessThan(16);
      expect(zone.tileY).toBeGreaterThanOrEqual(0);
      expect(zone.tileY).toBeLessThan(14);
      expect(id).toBe(zone.id);
    }
  });

  it("each zone has a clickable item or is explicitly null", () => {
    expect(ZONES.desk.clickable).toBe("computer");
    expect(ZONES.phone.clickable).toBe("phone");
    expect(ZONES.sofa.clickable).toBeNull();
    expect(ZONES.printer.clickable).toBe("printer");
    expect(ZONES.server.clickable).toBe("server");
    expect(ZONES.door.clickable).toBe("door");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent/dashboard && npx vitest run src/views/office/zones.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement zones.ts**

Create `agent/dashboard/src/views/office/zones.ts`:

```typescript
import type { ActivityState, ClickableItem } from "./office-bridge";

export type ZoneId = "desk" | "phone" | "sofa" | "printer" | "server" | "door";

export interface ZoneDef {
  id: ZoneId;
  tileX: number;
  tileY: number;
  label: string;
  clickable: ClickableItem | null;
  /** Direction character faces when idle at this zone (for sprite frame selection) */
  facingDir: "down" | "left" | "right" | "up";
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  desk:    { id: "desk",    tileX: 7,  tileY: 7,  label: "Desk",        clickable: "computer", facingDir: "up" },
  phone:   { id: "phone",   tileX: 12, tileY: 4,  label: "Phone",       clickable: "phone",    facingDir: "up" },
  sofa:    { id: "sofa",    tileX: 12, tileY: 11, label: "Sofa",        clickable: null,       facingDir: "down" },
  printer: { id: "printer", tileX: 2,  tileY: 11, label: "Printer",     clickable: "printer",  facingDir: "right" },
  server:  { id: "server",  tileX: 2,  tileY: 4,  label: "Server Rack", clickable: "server",   facingDir: "right" },
  door:    { id: "door",    tileX: 7,  tileY: 13, label: "Door",        clickable: "door",     facingDir: "down" },
};

const ACTIVITY_TO_ZONE: Record<ActivityState, ZoneId> = {
  idle: "sofa",
  thinking: "desk",
  calling: "phone",
  scheduled: "printer",
  error: "server",
  webhook: "door",
};

export function zoneForActivity(activity: ActivityState): ZoneId {
  return ACTIVITY_TO_ZONE[activity];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent/dashboard && npx vitest run src/views/office/zones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/dashboard/src/views/office/zones.ts agent/dashboard/src/views/office/zones.test.ts
git commit -m "feat(office): add zone definitions and activity-to-zone mapping"
```

---

### Task 7: Precomputed Route Table

**Files:**
- Create: `agent/dashboard/src/views/office/routes.ts`
- Create: `agent/dashboard/src/views/office/routes.test.ts`

- [ ] **Step 1: Write failing test**

Create `agent/dashboard/src/views/office/routes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getRoute, ZONE_IDS } from "./routes";

describe("routes", () => {
  it("has routes for all 30 zone pairs", () => {
    let count = 0;
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        const route = getRoute(from, to);
        expect(route.length).toBeGreaterThanOrEqual(2);
        count++;
      }
    }
    expect(count).toBe(30);
  });

  it("route starts at source zone and ends at target zone", () => {
    const route = getRoute("desk", "phone");
    expect(route[0]).toEqual([7, 7]);  // desk position
    expect(route[route.length - 1]).toEqual([12, 4]);  // phone position
  });

  it("all coordinates are within 16x14 grid", () => {
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        for (const [x, y] of getRoute(from, to)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(16);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(14);
        }
      }
    }
  });

  it("reverse route is the reverse of forward route", () => {
    const forward = getRoute("desk", "sofa");
    const reverse = getRoute("sofa", "desk");
    expect(reverse).toEqual([...forward].reverse());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent/dashboard && npx vitest run src/views/office/routes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement routes.ts**

Create `agent/dashboard/src/views/office/routes.ts`:

```typescript
import type { ZoneId } from "./zones";
import { ZONES } from "./zones";

export const ZONE_IDS: ZoneId[] = ["desk", "phone", "sofa", "printer", "server", "door"];

type RouteKey = `${ZoneId}→${ZoneId}`;

/**
 * Precomputed routes between all 30 zone pairs.
 * Each route is an array of [tileX, tileY] waypoints.
 * Routes go through the central corridor area (~column 7, rows 6-8).
 */
const ROUTES: Partial<Record<RouteKey, [number, number][]>> = {
  // From desk (7,7)
  "desk→phone":   [[7,7], [8,6], [9,5], [10,4], [12,4]],
  "desk→sofa":    [[7,7], [8,8], [9,9], [10,10], [12,11]],
  "desk→printer": [[7,7], [6,8], [5,9], [4,10], [2,11]],
  "desk→server":  [[7,7], [6,6], [5,5], [4,4], [2,4]],
  "desk→door":    [[7,7], [7,9], [7,11], [7,13]],

  // From phone (12,4)
  "phone→sofa":    [[12,4], [12,6], [12,8], [12,10], [12,11]],
  "phone→printer": [[12,4], [10,5], [8,6], [6,8], [4,10], [2,11]],
  "phone→server":  [[12,4], [10,4], [8,4], [5,4], [2,4]],
  "phone→door":    [[12,4], [10,6], [8,8], [7,10], [7,13]],

  // From sofa (12,11)
  "sofa→printer": [[12,11], [10,11], [8,11], [5,11], [2,11]],
  "sofa→server":  [[12,11], [10,10], [8,8], [6,6], [4,5], [2,4]],
  "sofa→door":    [[12,11], [10,12], [8,13], [7,13]],

  // From printer (2,11)
  "printer→server": [[2,11], [2,9], [2,7], [2,5], [2,4]],
  "printer→door":   [[2,11], [4,12], [6,13], [7,13]],

  // From server (2,4)
  "server→door": [[2,4], [4,6], [5,8], [6,10], [7,12], [7,13]],
};

// Generate reverse routes
for (const [key, route] of Object.entries(ROUTES)) {
  const [from, to] = key.split("→") as [ZoneId, ZoneId];
  const reverseKey: RouteKey = `${to}→${from}`;
  if (!ROUTES[reverseKey]) {
    ROUTES[reverseKey] = [...route].reverse();
  }
}

export function getRoute(from: ZoneId, to: ZoneId): [number, number][] {
  if (from === to) return [[ZONES[from].tileX, ZONES[from].tileY]];
  const key: RouteKey = `${from}→${to}`;
  const route = ROUTES[key];
  if (!route) {
    // Fallback: direct line (should never happen with complete table)
    return [[ZONES[from].tileX, ZONES[from].tileY], [ZONES[to].tileX, ZONES[to].tileY]];
  }
  return route;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent/dashboard && npx vitest run src/views/office/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/dashboard/src/views/office/routes.ts agent/dashboard/src/views/office/routes.test.ts
git commit -m "feat(office): add precomputed route table for 30 zone pairs"
```

---

### Task 8: Asset Manifest

**Files:**
- Create: `agent/dashboard/src/views/office/asset-manifest.ts`
- Create: `agent/dashboard/src/views/office/asset-manifest.test.ts`

- [ ] **Step 1: Write failing test**

Create `agent/dashboard/src/views/office/asset-manifest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ASSETS } from "./asset-manifest";

describe("asset-manifest", () => {
  it("has required keys for character rendering", () => {
    expect(ASSETS.body).toBeDefined();
    expect(ASSETS.shadow).toBeDefined();
    expect(ASSETS.hairs).toBeDefined();
  });

  it("has at least 6 outfit entries", () => {
    const outfitKeys = Object.keys(ASSETS).filter((k) => k.startsWith("outfit"));
    expect(outfitKeys.length).toBeGreaterThanOrEqual(6);
  });

  it("has tileset entry", () => {
    expect(ASSETS.tileset32).toBeDefined();
  });

  it("all paths start with /dashboard/pixel-assets/", () => {
    for (const [key, path] of Object.entries(ASSETS)) {
      expect(path, `${key} path`).toMatch(/^\/dashboard\/pixel-assets\//);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent/dashboard && npx vitest run src/views/office/asset-manifest.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement asset-manifest.ts**

Create `agent/dashboard/src/views/office/asset-manifest.ts`:

```typescript
/**
 * Explicit map of logical asset names to actual file paths.
 * Avoids string concatenation with space-containing filenames.
 * All paths are relative to the Vite public dir (served at /dashboard/).
 */
export const ASSETS = {
  // Character model
  body: "/dashboard/pixel-assets/metrocity/CharacterModel/Character Model.png",
  shadow: "/dashboard/pixel-assets/metrocity/CharacterModel/Shadow.png",
  hairs: "/dashboard/pixel-assets/metrocity/Hair/Hairs.png",

  // Outfits (casual)
  outfit1: "/dashboard/pixel-assets/metrocity/Outfits/Outfit1.png",
  outfit2: "/dashboard/pixel-assets/metrocity/Outfits/Outfit2.png",
  outfit3: "/dashboard/pixel-assets/metrocity/Outfits/Outfit3.png",
  outfit4: "/dashboard/pixel-assets/metrocity/Outfits/Outfit4.png",
  outfit5: "/dashboard/pixel-assets/metrocity/Outfits/Outfit5.png",
  outfit6: "/dashboard/pixel-assets/metrocity/Outfits/Outfit6.png",

  // Suits
  suit1: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",
  suit2: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",
  suit3: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",
  suit4: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",

  // Tileset
  tileset32: "/dashboard/pixel-assets/office-tileset/Office Tileset All 32x32.png",

  // Pre-built office design reference (for tilemap authoring)
  officeLevel3: "/dashboard/pixel-assets/office-tileset/Office Designs/Office Level 3.png",
} as const;

/** Frame dimensions for sprite sheets */
export const FRAME = {
  width: 32,
  height: 32,
} as const;

/** Body sheet layout: 24 columns × 6 rows */
export const BODY_SHEET = {
  columns: 24,
  rows: 6,  // 6 skin/palette variants
  framesPerDirection: 6,
  directions: 4,  // down, left, right, up (verify in-engine)
} as const;

/** Hair sheet layout: 24 columns × 8 rows */
export const HAIR_SHEET = {
  columns: 24,
  rows: 8,
} as const;

/** Outfit sheet layout: 24 columns × 1 row each */
export const OUTFIT_SHEET = {
  columns: 24,
  rows: 1,
} as const;

/** Suit sheet layout: 24 columns × 4 rows */
export const SUIT_SHEET = {
  columns: 24,
  rows: 4,  // 4 suit variants
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent/dashboard && npx vitest run src/views/office/asset-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/dashboard/src/views/office/asset-manifest.ts agent/dashboard/src/views/office/asset-manifest.test.ts
git commit -m "feat(office): add asset manifest mapping logical names to file paths"
```

---

### Task 9: Tilemap Data

**Files:**
- Create: `agent/dashboard/src/views/office/tilemap-data.ts`

- [ ] **Step 1: Create tilemap-data.ts**

This is a hand-authored tile index array. The tileset (`Office Tileset All 32x32.png`, 512×1024) has 16 columns × 32 rows = 512 tile indices. We define a 16×14 grid with tile indices referencing that sheet.

Create `agent/dashboard/src/views/office/tilemap-data.ts`:

```typescript
/**
 * Office tilemap: 16 columns × 14 rows.
 * Each number is a tile index into "Office Tileset All 32x32.png" (16 cols × 32 rows).
 *
 * The tileset is 512×1024px at 32×32 per tile = 16 columns, 32 rows.
 * Index = row * 16 + col.
 *
 * We use two layers: floor and furniture.
 * -1 means empty/transparent.
 */

export const TILE_SIZE = 32;
export const MAP_COLS = 16;
export const MAP_ROWS = 14;
export const CANVAS_WIDTH = MAP_COLS * TILE_SIZE;   // 512
export const CANVAS_HEIGHT = MAP_ROWS * TILE_SIZE;  // 448

/**
 * Floor layer — basic floor tiles covering the entire room.
 * Uses a simple repeating floor tile pattern.
 * Tile indices reference the office tileset (row * 16 + col).
 *
 * This is a placeholder layout — visual refinement happens during manual testing.
 * The key structural elements (walls, floor area) are correct for zone positioning.
 */

// Floor tile (a neutral office floor tile from the tileset)
const F = 0;   // Floor — will be set to actual tileset index during visual tuning
const W = -1;  // Wall / empty

export const FLOOR_LAYER: number[] = [
  // Row 0 (top wall)
  W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
  // Row 1
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 2
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 3
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 4 (server zone at col 2, phone zone at col 12)
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 5
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 6
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 7 (desk zone at col 7)
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 8
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 9
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 10
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 11 (printer zone at col 2, sofa zone at col 12)
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 12
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  // Row 13 (door zone at col 7, bottom wall)
  W, W, W, W, W, W, W, F, W, W, W, W, W, W, W, W,
];

/**
 * Furniture layer — decorative furniture sprites overlaid on the floor.
 * -1 = transparent (no furniture at this tile).
 *
 * Placeholder: actual tile indices will be set during visual tuning with the tileset.
 * The zones array in zones.ts defines where interactive furniture lives.
 */
export const FURNITURE_LAYER: number[] = new Array(MAP_COLS * MAP_ROWS).fill(-1);
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/tilemap-data.ts
git commit -m "feat(office): add tilemap data structure for 16x14 office grid"
```

---

### Task 10: Ambient Logic

**Files:**
- Create: `agent/dashboard/src/views/office/ambient.ts`
- Create: `agent/dashboard/src/views/office/ambient.test.ts`

- [ ] **Step 1: Write failing test**

Create `agent/dashboard/src/views/office/ambient.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getPlantState, getWindowTint, CoffeeCounter } from "./ambient";

describe("ambient", () => {
  describe("plant state", () => {
    it("healthy when 0 errors", () => {
      expect(getPlantState(0)).toBe("healthy");
    });
    it("drooping for 1-2 errors", () => {
      expect(getPlantState(1)).toBe("drooping");
      expect(getPlantState(2)).toBe("drooping");
    });
    it("wilted for 3-4 errors", () => {
      expect(getPlantState(3)).toBe("wilted");
      expect(getPlantState(4)).toBe("wilted");
    });
    it("dead for 5+ errors", () => {
      expect(getPlantState(5)).toBe("dead");
      expect(getPlantState(10)).toBe("dead");
    });
  });

  describe("window tint", () => {
    it("morning yellow from 6-11", () => {
      expect(getWindowTint(8)).toEqual({ r: 255, g: 240, b: 200, a: 0.15 });
    });
    it("midday clear from 12-16", () => {
      expect(getWindowTint(14)).toEqual({ r: 255, g: 255, b: 255, a: 0 });
    });
    it("evening orange from 17-20", () => {
      expect(getWindowTint(18)).toEqual({ r: 255, g: 180, b: 100, a: 0.2 });
    });
    it("night blue from 21-5", () => {
      expect(getWindowTint(23)).toEqual({ r: 100, g: 120, b: 200, a: 0.3 });
      expect(getWindowTint(3)).toEqual({ r: 100, g: 120, b: 200, a: 0.3 });
    });
  });

  describe("coffee counter", () => {
    it("starts at 0", () => {
      const cc = new CoffeeCounter();
      expect(cc.count).toBe(0);
    });
    it("increments on activity transition from idle", () => {
      const cc = new CoffeeCounter();
      cc.onActivityChange("idle", "thinking");
      expect(cc.count).toBe(1);
    });
    it("does not increment on non-idle transitions", () => {
      const cc = new CoffeeCounter();
      cc.onActivityChange("thinking", "calling");
      expect(cc.count).toBe(0);
    });
    it("caps at 5", () => {
      const cc = new CoffeeCounter();
      for (let i = 0; i < 8; i++) {
        cc.onActivityChange("idle", "thinking");
      }
      expect(cc.count).toBe(5);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent/dashboard && npx vitest run src/views/office/ambient.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ambient.ts**

Create `agent/dashboard/src/views/office/ambient.ts`:

```typescript
import type { ActivityState } from "./office-bridge";

export type PlantState = "healthy" | "drooping" | "wilted" | "dead";

export function getPlantState(consecutiveErrors: number): PlantState {
  if (consecutiveErrors === 0) return "healthy";
  if (consecutiveErrors <= 2) return "drooping";
  if (consecutiveErrors <= 4) return "wilted";
  return "dead";
}

export interface TintColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getWindowTint(hour: number): TintColor {
  if (hour >= 6 && hour <= 11) return { r: 255, g: 240, b: 200, a: 0.15 };  // morning yellow
  if (hour >= 12 && hour <= 16) return { r: 255, g: 255, b: 255, a: 0 };     // midday clear
  if (hour >= 17 && hour <= 20) return { r: 255, g: 180, b: 100, a: 0.2 };   // evening orange
  return { r: 100, g: 120, b: 200, a: 0.3 };  // night blue
}

export class CoffeeCounter {
  count = 0;
  private lastResetTime = Date.now();

  onActivityChange(prev: ActivityState, next: ActivityState): void {
    // Reset after 30min idle
    if (prev === "idle" && Date.now() - this.lastResetTime > 30 * 60_000) {
      this.count = 0;
    }
    if (prev === "idle" && next !== "idle") {
      this.count = Math.min(this.count + 1, 5);
      this.lastResetTime = Date.now();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent/dashboard && npx vitest run src/views/office/ambient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/dashboard/src/views/office/ambient.ts agent/dashboard/src/views/office/ambient.test.ts
git commit -m "feat(office): add ambient logic (plant state, window tint, coffee counter)"
```

---

## Chunk 3: Phaser Scene & Character

### Task 11: Install Phaser

**Files:**
- Modify: `agent/dashboard/package.json`

- [ ] **Step 1: Install Phaser**

```bash
cd agent/dashboard && npm install phaser@3.90.0 --save-exact
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/package.json agent/dashboard/package-lock.json
git commit -m "deps: add phaser 3.90.0 (pinned, dynamically imported)"
```

---

### Task 12: Character Compositing Module

**Files:**
- Create: `agent/dashboard/src/views/office/character.ts`

This module handles the character sprite compositing and animation state machine. It depends on Phaser types but is structured as a class that receives a Phaser scene reference.

- [ ] **Step 1: Create character.ts**

```typescript
import { ASSETS, FRAME, BODY_SHEET } from "./asset-manifest";
import type { ZoneDef } from "./zones";
import type { ActivityState } from "./office-bridge";

/**
 * Direction mapping for sprite sheet.
 * Body sheet has 4 directions × 6 frames = 24 columns per row.
 * Actual direction order needs visual verification — this is the initial assumption.
 */
const DIR_MAP: Record<string, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

export interface CharacterConfig {
  skin: number;
  hair: number;
  outfit: string;
}

export class Character {
  private scene: Phaser.Scene;
  private bodySprite!: Phaser.GameObjects.Sprite;
  private hairSprite!: Phaser.GameObjects.Sprite;
  private outfitSprite!: Phaser.GameObjects.Sprite;
  private shadowSprite!: Phaser.GameObjects.Sprite;
  private container!: Phaser.GameObjects.Container;

  private config: CharacterConfig = { skin: 0, hair: 0, outfit: "outfit1" };
  private currentDir: string = "down";
  private walkFrame = 0;
  private isWalking = false;
  private walkPath: [number, number][] = [];
  private walkIndex = 0;
  private walkSpeed = 64; // pixels per second (2 tiles/s)
  private walkTimer = 0;
  private reducedMotion = false;

  // Sub-animation state
  private idleFrameTimer = 0;
  private idleFrameIndex = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  create(x: number, y: number): void {
    this.shadowSprite = this.scene.add.sprite(0, 4, "shadow");
    this.bodySprite = this.scene.add.sprite(0, 0, "body");
    this.hairSprite = this.scene.add.sprite(0, 0, "hairs");
    this.outfitSprite = this.scene.add.sprite(0, 0, "outfit1");

    this.container = this.scene.add.container(x, y, [
      this.shadowSprite,
      this.bodySprite,
      this.outfitSprite,
      this.hairSprite,
    ]);
    this.container.setSize(FRAME.width, FRAME.height);
    this.container.setInteractive();

    this.updateFrame();
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  setConfig(config: CharacterConfig): void {
    this.config = config;
    this.updateFrame();
  }

  /**
   * Start walking along a precomputed route (tile coords).
   * Converts tiles to pixel positions.
   */
  walkTo(path: [number, number][]): void {
    if (this.reducedMotion || path.length <= 1) {
      // Teleport to destination
      const dest = path[path.length - 1];
      this.container.setPosition(dest[0] * FRAME.width + FRAME.width / 2, dest[1] * FRAME.height + FRAME.height / 2);
      this.isWalking = false;
      return;
    }

    this.walkPath = path;
    this.walkIndex = 0;
    this.isWalking = true;
    this.walkTimer = 0;
  }

  /** Called every frame from OfficeScene.update() */
  update(delta: number): void {
    if (this.isWalking) {
      this.updateWalk(delta);
    } else {
      this.updateIdle(delta);
    }
  }

  isCurrentlyWalking(): boolean {
    return this.isWalking;
  }

  private updateWalk(delta: number): void {
    if (this.walkIndex >= this.walkPath.length - 1) {
      this.isWalking = false;
      this.walkFrame = 0;
      this.updateFrame();
      return;
    }

    const current = this.walkPath[this.walkIndex];
    const next = this.walkPath[this.walkIndex + 1];
    const startX = current[0] * FRAME.width + FRAME.width / 2;
    const startY = current[1] * FRAME.height + FRAME.height / 2;
    const endX = next[0] * FRAME.width + FRAME.width / 2;
    const endY = next[1] * FRAME.height + FRAME.height / 2;

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = (dist / this.walkSpeed) * 1000; // ms

    this.walkTimer += delta;
    const t = Math.min(this.walkTimer / duration, 1);

    this.container.setPosition(
      startX + dx * t,
      startY + dy * t,
    );

    // Update direction based on movement
    if (Math.abs(dx) > Math.abs(dy)) {
      this.currentDir = dx > 0 ? "right" : "left";
    } else {
      this.currentDir = dy > 0 ? "down" : "up";
    }

    // Animate walk cycle (6 frames)
    this.walkFrame = Math.floor((this.walkTimer / 150) % 6);
    this.updateFrame();

    if (t >= 1) {
      this.walkIndex++;
      this.walkTimer = 0;
    }
  }

  private updateIdle(delta: number): void {
    // Simple idle: static frame, facing zone direction
    this.idleFrameTimer += delta;
    if (this.idleFrameTimer > 500) {
      this.idleFrameTimer = 0;
      // Subtle idle animation: alternate between frame 0 and 1
      this.idleFrameIndex = this.idleFrameIndex === 0 ? 1 : 0;
      this.walkFrame = this.idleFrameIndex;
      this.updateFrame();
    }
  }

  setFacing(dir: string): void {
    this.currentDir = dir;
    this.updateFrame();
  }

  private updateFrame(): void {
    const dirIndex = DIR_MAP[this.currentDir] ?? 0;
    const frameCol = dirIndex * BODY_SHEET.framesPerDirection + this.walkFrame;

    // Body: row = skin index
    this.bodySprite.setFrame(this.config.skin * BODY_SHEET.columns + frameCol);

    // Hair: row = hair index (reversed order in sheet, but index maps directly)
    this.hairSprite.setFrame(this.config.hair * BODY_SHEET.columns + frameCol);

    // Outfit: determine which sheet + row
    const outfitMatch = this.config.outfit.match(/^(outfit|suit)(\d)$/);
    if (outfitMatch) {
      if (outfitMatch[1] === "outfit") {
        // Switch to the correct outfit spritesheet and set frame
        this.outfitSprite.setTexture(`outfit${outfitMatch[2]}`);
        this.outfitSprite.setFrame(frameCol);
      } else {
        // Suit sheet has 4 rows (suit1=row0, suit2=row1, etc.)
        this.outfitSprite.setTexture("suit");
        const suitRow = parseInt(outfitMatch[2], 10) - 1;
        this.outfitSprite.setFrame(suitRow * BODY_SHEET.columns + frameCol);
      }
    }

    // Handle flipX for left/right if they use the same strip
    const needsFlip = this.currentDir === "left";
    this.bodySprite.setFlipX(needsFlip);
    this.hairSprite.setFlipX(needsFlip);
    this.outfitSprite.setFlipX(needsFlip);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/character.ts
git commit -m "feat(office): add character compositing and walk animation"
```

---

### Task 13: Subagent Clone Manager

**Files:**
- Create: `agent/dashboard/src/views/office/subagent-clones.ts`

- [ ] **Step 1: Create subagent-clones.ts**

```typescript
const MAX_VISIBLE = 5;
const CLONE_ALPHA = 0.5;
const FADE_DURATION = 500;
const OFFSET_PX = 16;

interface CloneEntry {
  id: string;
  type: string;
  description: string;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
}

export class SubagentCloneManager {
  private scene: Phaser.Scene;
  private clones: CloneEntry[] = [];
  private baseX: number;
  private baseY: number;
  private overflowText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, baseX: number, baseY: number) {
    this.scene = scene;
    this.baseX = baseX;
    this.baseY = baseY;
  }

  spawn(id: string, type: string, description: string): void {
    if (this.clones.length >= MAX_VISIBLE) {
      this.updateOverflow();
      return;
    }

    const offsetIndex = this.clones.length;
    const x = this.baseX + (offsetIndex + 1) * OFFSET_PX;
    const y = this.baseY;

    const sprite = this.scene.add.sprite(x, y, "body");
    sprite.setAlpha(0);
    sprite.setFrame(0);

    const label = this.scene.add.text(x, y - 20, type, {
      fontSize: "8px",
      color: "#ffffff",
      backgroundColor: "#00000080",
      padding: { x: 2, y: 1 },
    });
    label.setOrigin(0.5);
    label.setAlpha(0);

    // Fade in
    this.scene.tweens.add({ targets: [sprite, label], alpha: CLONE_ALPHA, duration: FADE_DURATION });

    this.clones.push({ id, type, description, sprite, label });
  }

  despawn(id: string): void {
    const index = this.clones.findIndex((c) => c.id === id);
    if (index === -1) return;

    const clone = this.clones[index];
    this.scene.tweens.add({
      targets: [clone.sprite, clone.label],
      alpha: 0,
      duration: FADE_DURATION,
      onComplete: () => {
        clone.sprite.destroy();
        clone.label.destroy();
      },
    });

    this.clones.splice(index, 1);
    this.updateOverflow();
  }

  /** Sync with bridge subagent list */
  sync(subagents: { id: string; type: string; description: string }[]): void {
    const currentIds = new Set(this.clones.map((c) => c.id));
    const newIds = new Set(subagents.map((s) => s.id));

    // Despawn removed
    for (const clone of [...this.clones]) {
      if (!newIds.has(clone.id)) this.despawn(clone.id);
    }

    // Spawn new
    for (const s of subagents) {
      if (!currentIds.has(s.id)) this.spawn(s.id, s.type, s.description);
    }
  }

  private updateOverflow(): void {
    // Count overflow (subagents beyond MAX_VISIBLE)
    // This is tracked externally via bridge state
    if (this.overflowText) {
      this.overflowText.destroy();
      this.overflowText = null;
    }
  }

  destroy(): void {
    for (const clone of this.clones) {
      clone.sprite.destroy();
      clone.label.destroy();
    }
    this.clones = [];
    this.overflowText?.destroy();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/subagent-clones.ts
git commit -m "feat(office): add subagent clone sprite manager"
```

---

### Task 14: Phaser Office Scene

**Files:**
- Create: `agent/dashboard/src/views/office/office-scene.ts`

This is the main Phaser scene that ties together tilemap, character, zones, ambient, and subagent clones.

- [ ] **Step 1: Create office-scene.ts**

```typescript
import type { OfficeBridge, ClickableItem } from "./office-bridge";
import { ASSETS, FRAME, BODY_SHEET, HAIR_SHEET, OUTFIT_SHEET, SUIT_SHEET } from "./asset-manifest";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, FLOOR_LAYER } from "./tilemap-data";
import { ZONES, zoneForActivity, type ZoneId } from "./zones";
import { getRoute } from "./routes";
import { Character } from "./character";
import { SubagentCloneManager } from "./subagent-clones";
import { getPlantState, getWindowTint, CoffeeCounter } from "./ambient";

export class OfficeScene extends Phaser.Scene {
  private bridge!: OfficeBridge;
  private lastSeenRevision = -1;
  private character!: Character;
  private currentZone: ZoneId = "sofa";
  private cloneManager!: SubagentCloneManager;
  private coffeeCounter = new CoffeeCounter();

  // Ambient objects
  private clockGraphics!: Phaser.GameObjects.Graphics;
  private windowOverlay!: Phaser.GameObjects.Rectangle;
  private clockTimer = 0;

  // Click zones
  private clickZones: Map<ClickableItem, Phaser.GameObjects.Zone> = new Map();
  private _visibilityHandler: () => void = () => {};

  constructor() {
    super({ key: "OfficeScene" });
  }

  init(data: { bridge: OfficeBridge }): void {
    this.bridge = data.bridge;
  }

  preload(): void {
    // Loading bar
    const bar = this.add.graphics();
    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0x3b82f6, 1);
      bar.fillRect(100, 220, 312 * value, 16);
    });
    this.load.on("complete", () => bar.destroy());

    // Load assets
    this.load.spritesheet("body", ASSETS.body, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });
    this.load.spritesheet("hairs", ASSETS.hairs, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });
    this.load.spritesheet("shadow", ASSETS.shadow, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });

    // Load all outfit sheets
    for (let i = 1; i <= 6; i++) {
      const key = `outfit${i}` as keyof typeof ASSETS;
      this.load.spritesheet(`outfit${i}`, ASSETS[key], {
        frameWidth: FRAME.width, frameHeight: FRAME.height,
      });
    }

    // Suit sheet
    this.load.spritesheet("suit", ASSETS.suit1, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });

    // Tileset image (not as spritesheet — we'll draw tiles manually or use as tilemap image)
    this.load.image("tileset", ASSETS.tileset32);

    // Missing asset handler
    this.load.on("loaderror", (file: { key: string }) => {
      console.warn(`[OfficeScene] Failed to load: ${file.key}`);
    });
  }

  create(): void {
    // Background
    this.cameras.main.setBackgroundColor("#2a2a3e");

    // Draw floor (simple colored rectangles for now — tileset indices will be mapped later)
    this.drawFloor();

    // Draw furniture placeholders at zone positions
    this.drawFurniture();

    // Create character at sofa (default idle zone)
    const startZone = ZONES.sofa;
    this.character = new Character(this);
    this.character.create(
      startZone.tileX * TILE_SIZE + TILE_SIZE / 2,
      startZone.tileY * TILE_SIZE + TILE_SIZE / 2,
    );
    this.character.setFacing(startZone.facingDir);
    this.character.setConfig(this.bridge.character);

    // Character click
    this.character.getContainer().on("pointerdown", () => {
      this.bridge.onFurnitureClick?.("character");
    });

    // Subagent clones
    const deskZone = ZONES.desk;
    this.cloneManager = new SubagentCloneManager(
      this,
      deskZone.tileX * TILE_SIZE + TILE_SIZE / 2,
      deskZone.tileY * TILE_SIZE + TILE_SIZE / 2,
    );

    // Create click zones on furniture
    this.createClickZones();

    // Ambient: clock
    this.clockGraphics = this.add.graphics();
    this.drawClock();

    // Ambient: window light overlay
    this.windowOverlay = this.add.rectangle(
      MAP_COLS * TILE_SIZE / 2, 0,
      MAP_COLS * TILE_SIZE, TILE_SIZE * 2,
      0xffffff, 0,
    ).setOrigin(0.5, 0);

    // Visibility pause — store handler for cleanup
    this._visibilityHandler = () => {
      if (document.hidden) {
        this.scene.pause();
      } else {
        this.scene.resume();
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);

    // Clean up on scene shutdown
    this.events.on("shutdown", () => {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    });
  }

  update(_time: number, delta: number): void {
    // Check bridge for changes
    if (this.bridge.revision !== this.lastSeenRevision) {
      this.lastSeenRevision = this.bridge.revision;
      this.onBridgeUpdate();
    }

    // Update character animation
    this.character.update(delta);

    // Update clock every 60s
    this.clockTimer += delta;
    if (this.clockTimer > 60_000) {
      this.clockTimer = 0;
      this.drawClock();
      this.updateWindowTint();
    }
  }

  private onBridgeUpdate(): void {
    const state = this.bridge.state;

    // Activity change → move to new zone
    const targetZone = zoneForActivity(state.activity);
    if (targetZone !== this.currentZone && !this.character.isCurrentlyWalking()) {
      const prevZone = this.currentZone; // Track for coffee
      const route = getRoute(this.currentZone, targetZone);
      this.character.walkTo(route);
      this.currentZone = targetZone;

      // Coffee counter: transitioning away from sofa means leaving idle
      if (prevZone === "sofa") {
        this.coffeeCounter.onActivityChange("idle", state.activity);
      }
    }

    // When character arrives, face the zone's direction
    if (!this.character.isCurrentlyWalking()) {
      this.character.setFacing(ZONES[this.currentZone].facingDir);
    }

    // Character config
    this.character.setConfig(this.bridge.character);

    // Subagent clones
    this.cloneManager.sync(state.subagents);

    // Ambient: plant state based on errors
    // (visual update would go here when plant sprites are available)
  }

  private drawFloor(): void {
    const g = this.add.graphics();
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = FLOOR_LAYER[row * MAP_COLS + col];
        if (tile === -1) {
          // Wall
          g.fillStyle(0x4a4a5e, 1);
        } else {
          // Floor
          g.fillStyle(0x6b6b8a, 1);
        }
        g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    // Grid lines (subtle)
    g.lineStyle(1, 0x555570, 0.3);
    for (let row = 0; row <= MAP_ROWS; row++) {
      g.lineBetween(0, row * TILE_SIZE, MAP_COLS * TILE_SIZE, row * TILE_SIZE);
    }
    for (let col = 0; col <= MAP_COLS; col++) {
      g.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    }
  }

  private drawFurniture(): void {
    const g = this.add.graphics();
    const colors: Record<ZoneId, number> = {
      desk: 0x8b6914,
      phone: 0x2e7d32,
      sofa: 0x7b1fa2,
      printer: 0x1565c0,
      server: 0xc62828,
      door: 0x6d4c41,
    };

    for (const [id, zone] of Object.entries(ZONES) as [ZoneId, typeof ZONES[ZoneId]][]) {
      g.fillStyle(colors[id], 0.6);
      g.fillRect(
        zone.tileX * TILE_SIZE + 2,
        zone.tileY * TILE_SIZE + 2,
        TILE_SIZE - 4,
        TILE_SIZE - 4,
      );

      // Label
      this.add.text(
        zone.tileX * TILE_SIZE + TILE_SIZE / 2,
        zone.tileY * TILE_SIZE - 6,
        zone.label,
        { fontSize: "8px", color: "#ffffff" },
      ).setOrigin(0.5, 1);
    }
  }

  private createClickZones(): void {
    for (const [id, zone] of Object.entries(ZONES) as [ZoneId, typeof ZONES[ZoneId]][]) {
      if (!zone.clickable) continue;
      const clickZone = this.add.zone(
        zone.tileX * TILE_SIZE + TILE_SIZE / 2,
        zone.tileY * TILE_SIZE + TILE_SIZE / 2,
        TILE_SIZE,
        TILE_SIZE,
      ).setInteractive();

      clickZone.on("pointerdown", () => {
        this.bridge.onFurnitureClick?.(zone.clickable!);
      });

      // Hover cursor
      clickZone.on("pointerover", () => {
        this.input.setDefaultCursor("pointer");
      });
      clickZone.on("pointerout", () => {
        this.input.setDefaultCursor("default");
      });

      this.clickZones.set(zone.clickable, clickZone);
    }
  }

  private drawClock(): void {
    this.clockGraphics.clear();
    const cx = MAP_COLS * TILE_SIZE - TILE_SIZE * 2;
    const cy = TILE_SIZE / 2 + 4;
    const r = 10;

    // Clock face
    this.clockGraphics.fillStyle(0xffffff, 0.9);
    this.clockGraphics.fillCircle(cx, cy, r);
    this.clockGraphics.lineStyle(1, 0x333333, 1);
    this.clockGraphics.strokeCircle(cx, cy, r);

    // Hands
    const now = new Date();
    const hourAngle = ((now.getHours() % 12) / 12) * Math.PI * 2 - Math.PI / 2;
    const minAngle = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;

    this.clockGraphics.lineStyle(2, 0x333333, 1);
    this.clockGraphics.lineBetween(cx, cy, cx + Math.cos(hourAngle) * 6, cy + Math.sin(hourAngle) * 6);
    this.clockGraphics.lineStyle(1, 0x666666, 1);
    this.clockGraphics.lineBetween(cx, cy, cx + Math.cos(minAngle) * 8, cy + Math.sin(minAngle) * 8);
  }

  private updateWindowTint(): void {
    const hour = new Date().getHours();
    const tint = getWindowTint(hour);
    const color = (tint.r << 16) | (tint.g << 8) | tint.b;
    this.windowOverlay.setFillStyle(color, tint.a);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/office-scene.ts
git commit -m "feat(office): add Phaser OfficeScene with tilemap, character, zones, ambient"
```

---

## Chunk 4: React Integration

### Task 15: Office Status Provider (SSE + Polling)

**Files:**
- Create: `agent/dashboard/src/views/office/office-status.ts`

- [ ] **Step 1: Create office-status.ts**

This module subscribes to SSE and polls endpoints, writing results to the bridge.

```typescript
import { botFetch, botSSE } from "../../lib/api";
import type { OfficeBridge, ActivityState } from "./office-bridge";

interface StatusResponse {
  state: ActivityState;
  talking_to: string | null;
  current_session_id?: string | null;
  last_active: string | null;
}

/**
 * Connect SSE and start polling. Returns a cleanup function.
 */
export function startOfficeStatus(bridge: OfficeBridge): () => void {
  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let idleStartedAt: number | null = null;

  function writeBridge(): void {
    bridge.revision++;
  }

  // Idle timer: increments idleSinceSec every second when idle
  function startIdleTimer(): void {
    if (idleTimer) clearInterval(idleTimer);
    idleStartedAt = Date.now();
    idleTimer = setInterval(() => {
      if (idleStartedAt) {
        bridge.state.idleSinceSec = Math.floor((Date.now() - idleStartedAt) / 1000);
        writeBridge();
      }
    }, 1000);
  }

  function stopIdleTimer(): void {
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    idleStartedAt = null;
    bridge.state.idleSinceSec = 0;
  }

  // SSE connection with reconnect
  function connectSSE(): void {
    if (disposed) return;

    es = botSSE("/api/status/stream", {
      onEvent: (eventType, data) => {
        if (disposed) return;
        try {
          switch (eventType) {
            case "snapshot": {
              const snap = JSON.parse(data) as StatusResponse;
              bridge.state.activity = snap.state;
              bridge.state.talkingTo = snap.talking_to;
              if (snap.state === "idle") startIdleTimer();
              writeBridge();
              break;
            }
            case "state": {
              const s = JSON.parse(data) as { prev: string; state: ActivityState; talkingTo: string | null };
              bridge.state.activity = s.state;
              bridge.state.talkingTo = s.talkingTo;
              if (s.state === "idle") {
                startIdleTimer();
              } else {
                stopIdleTimer();
              }
              writeBridge();
              break;
            }
            case "tool": {
              const t = JSON.parse(data) as { name: string; context: string };
              bridge.state.currentTool = t.name;
              bridge.state.currentToolContext = t.context;
              writeBridge();
              break;
            }
            case "subagent": {
              const sa = JSON.parse(data) as { action: string; id: string; type?: string; description?: string };
              if (sa.action === "spawn") {
                bridge.state.subagents = [
                  ...bridge.state.subagents,
                  { id: sa.id, type: sa.type ?? "general", description: sa.description ?? "" },
                ];
              } else if (sa.action === "complete") {
                bridge.state.subagents = bridge.state.subagents.filter((s) => s.id !== sa.id);
              }
              writeBridge();
              break;
            }
            case "heartbeat":
              // No-op, just keeps connection alive
              break;
          }
        } catch (err) {
          console.warn("[office-status] Failed to parse SSE event:", err);
        }
      },
      onError: () => {
        // EventSource will auto-reconnect; on reconnect the server sends a fresh snapshot
      },
    });
  }

  // Polling (10s interval for costs, tasks, schedule)
  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const [costsRes, tasksRes, scheduleRes] = await Promise.all([
        botFetch("/api/costs"),
        botFetch("/api/tasks"),
        botFetch("/api/schedule"),
      ]);

      if (costsRes.ok) {
        const costs = await costsRes.json();
        bridge.state.costToday = costs.today ?? 0;
      }

      if (tasksRes.ok) {
        const tasks = await tasksRes.json();
        // Find active task
        const active = Array.isArray(tasks)
          ? tasks.find((t: { status: string }) => t.status === "running")
          : null;
        bridge.state.taskStartedAt = active?.started_at ?? null;
        bridge.state.currentSessionId = active?.session_id ?? null;
      }

      if (scheduleRes.ok) {
        const schedule = await scheduleRes.json();
        if (Array.isArray(schedule) && schedule.length > 0) {
          bridge.state.scheduleNextRunAt = schedule[0].nextRunAt ?? null;
          bridge.state.consecutiveErrors = schedule[0].consecutiveErrors ?? 0;
        }
      }

      writeBridge();
    } catch (err) {
      console.warn("[office-status] Poll failed:", err);
    }
  }

  // Bootstrap: fetch initial data
  async function bootstrap(): Promise<void> {
    try {
      const statusRes = await botFetch("/api/status");
      if (statusRes.ok) {
        const status = (await statusRes.json()) as StatusResponse;
        bridge.state.activity = status.state;
        bridge.state.talkingTo = status.talking_to;
        bridge.state.currentSessionId = status.current_session_id ?? null;
        if (status.state === "idle") startIdleTimer();
      }

      // Load character config
      const charRes = await botFetch("/api/config/character");
      if (charRes.ok) {
        const char = await charRes.json();
        bridge.character.skin = char.skin ?? 0;
        bridge.character.hair = char.hair ?? 0;
        bridge.character.outfit = char.outfit ?? "outfit1";
      }

      writeBridge();
    } catch (err) {
      console.warn("[office-status] Bootstrap failed:", err);
    }

    await poll();
  }

  // Start everything
  bootstrap();
  connectSSE();
  pollTimer = setInterval(poll, 10_000);

  // Return cleanup
  return () => {
    disposed = true;
    es?.close();
    if (pollTimer) clearInterval(pollTimer);
    stopIdleTimer();
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/office-status.ts
git commit -m "feat(office): add SSE subscription + polling status provider"
```

---

### Task 16: Office View React Component

**Files:**
- Create: `agent/dashboard/src/views/office/office-view.tsx`

- [ ] **Step 1: Create office-view.tsx**

This is the main React wrapper — lazy-loads Phaser, manages the bridge, renders overlays and status bar.

```tsx
import { useRef, useEffect, useState, useCallback } from "react";
import { createBridge, type OfficeBridge, type ClickableItem, type ActivityState } from "./office-bridge";
import { startOfficeStatus } from "./office-status";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./tilemap-data";

// Status dot colors
const STATUS_COLORS: Record<ActivityState, string> = {
  idle: "bg-green-500",
  thinking: "bg-yellow-500",
  calling: "bg-blue-500",
  scheduled: "bg-purple-500",
  webhook: "bg-orange-500",
  error: "bg-red-500",
};

export default function OfficeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<OfficeBridge>(createBridge());
  const gameRef = useRef<Phaser.Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<ClickableItem | null>(null);
  const [bridgeState, setBridgeState] = useState(bridgeRef.current.state);

  // Sync bridge state to React for status bar (poll every 500ms)
  useEffect(() => {
    const timer = setInterval(() => {
      setBridgeState({ ...bridgeRef.current.state });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Set up furniture click handler
  useEffect(() => {
    bridgeRef.current.onFurnitureClick = (item: ClickableItem) => {
      if (item === "character") {
        setOverlay("character");
      } else {
        setOverlay(item);
      }
    };
    return () => {
      bridgeRef.current.onFurnitureClick = null;
    };
  }, []);

  // Start SSE + polling
  useEffect(() => {
    const cleanup = startOfficeStatus(bridgeRef.current);
    return cleanup;
  }, []);

  // Load Phaser and create game
  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        const Phaser = await import("phaser");
        const { OfficeScene } = await import("./office-scene");

        if (destroyed || !containerRef.current) return;

        const game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: containerRef.current,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          pixelArt: true,
          antialias: false,
          roundPixels: true,
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          backgroundColor: "#1a1a2e",
          scene: [],
        });

        game.scene.add("OfficeScene", OfficeScene, true, { bridge: bridgeRef.current });
        gameRef.current = game;
        setLoading(false);
      } catch (err) {
        console.error("[OfficeView] Failed to load Phaser:", err);
        setError("Failed to load Pixel Office.");
      }
    }

    // StrictMode guard: only create if no game exists
    if (!gameRef.current) {
      init();
    }

    return () => {
      destroyed = true;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    gameRef.current = null;
    // Re-trigger by forcing remount — simplest approach
    window.location.reload();
  }, []);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  // Close overlay on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOverlay]);

  // Format status bar text
  const formatStatus = () => {
    const s = bridgeState;
    const parts: string[] = [s.activity];

    if (s.currentTool && s.activity !== "idle") {
      const ctx = s.currentToolContext ? ` ${s.currentToolContext}` : "";
      parts.push(`${s.currentTool}${ctx}`);
    }

    if (s.taskStartedAt && s.activity !== "idle") {
      const elapsed = Math.floor((Date.now() - new Date(s.taskStartedAt).getTime()) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      parts.push(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    }

    if (s.activity === "idle" && s.idleSinceSec > 0) {
      if (s.idleSinceSec < 60) {
        parts.push(`last active ${s.idleSinceSec}s ago`);
      } else {
        parts.push(`last active ${Math.floor(s.idleSinceSec / 60)}m ago`);
      }
    }

    parts.push(`$${s.costToday.toFixed(2)} today`);

    return parts.join(" · ");
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-foreground mb-2">{error}</p>
          <button onClick={handleRetry} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Canvas container */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-background">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-muted-foreground">Loading Pixel Office...</div>
          </div>
        )}

        <div ref={containerRef} className="relative" />

        {/* Overlay panels */}
        {overlay && overlay !== "character" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20" onClick={closeOverlay}>
            <div className="bg-background border border-border rounded-lg shadow-lg max-w-2xl w-full max-h-[80%] overflow-auto p-4 m-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium text-foreground capitalize">{overlay}</h3>
                <button onClick={closeOverlay} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
              </div>
              <OverlayContent item={overlay} sessionId={bridgeState.currentSessionId} />
            </div>
          </div>
        )}

        {/* Character editor modal */}
        {overlay === "character" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20" onClick={closeOverlay}>
            <div className="bg-background border border-border rounded-lg shadow-lg max-w-sm w-full p-4 m-4" onClick={(e) => e.stopPropagation()}>
              <CharacterEditorLazy bridge={bridgeRef.current} onClose={closeOverlay} />
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-8 shrink-0 bg-sidebar border-t border-sidebar-border flex items-center px-3 gap-2 text-xs text-sidebar-foreground">
        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[bridgeState.activity]}`} />
        <span className="truncate">{formatStatus()}</span>
      </div>
    </div>
  );
}

/** Overlay content based on clicked furniture */
function OverlayContent({ item, sessionId }: { item: ClickableItem; sessionId: string | null }) {
  // For now, show a simple placeholder. Full integration with ConversationViewer etc. comes later.
  const [data, setData] = useState<unknown[] | null>(null);

  useEffect(() => {
    const sourceMap: Record<string, string> = {
      computer: sessionId ? `/api/sessions/${sessionId}` : "",
      phone: "/api/logs?source=interbot&limit=50",
      printer: "/api/schedule",
      server: "/api/logs?source=error&limit=50",
      door: "/api/logs?source=webhook&limit=50",
    };

    const url = sourceMap[item];
    if (!url) {
      setData([]);
      return;
    }

    import("../../lib/api").then(({ botFetch }) => {
      botFetch(url).then((r) => r.json()).then(setData).catch(() => setData([]));
    });
  }, [item, sessionId]);

  if (data === null) return <div className="text-muted-foreground text-sm">Loading...</div>;

  return (
    <pre className="text-xs text-foreground overflow-auto max-h-96 font-mono bg-muted/30 rounded p-2">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/** Lazy-loaded character editor */
function CharacterEditorLazy({ bridge, onClose }: { bridge: OfficeBridge; onClose: () => void }) {
  const [Editor, setEditor] = useState<React.ComponentType<{ bridge: OfficeBridge; onClose: () => void }> | null>(null);

  useEffect(() => {
    import("./character-editor").then((mod) => {
      setEditor(() => mod.default);
    });
  }, []);

  if (!Editor) return <div className="text-muted-foreground text-sm p-4">Loading editor...</div>;
  return <Editor bridge={bridge} onClose={onClose} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/office-view.tsx
git commit -m "feat(office): add OfficeView React wrapper with status bar and overlays"
```

---

### Task 17: Character Editor Modal

**Files:**
- Create: `agent/dashboard/src/views/office/character-editor.tsx`

- [ ] **Step 1: Create character-editor.tsx**

```tsx
import { useState } from "react";
import { botFetch } from "../../lib/api";
import type { OfficeBridge } from "./office-bridge";

interface Props {
  bridge: OfficeBridge;
  onClose: () => void;
}

const SKIN_COLORS = ["#f5d0a9", "#e8b88a", "#c68c5c", "#a0714f", "#6b4226", "#3d2b1f"];
const HAIR_LABELS = ["Short", "Curly", "Long", "Spiky", "Bob", "Ponytail", "Mohawk", "Bald"];
const OUTFIT_OPTIONS = [
  { id: "outfit1", label: "Casual 1" },
  { id: "outfit2", label: "Casual 2" },
  { id: "outfit3", label: "Casual 3" },
  { id: "outfit4", label: "Casual 4" },
  { id: "outfit5", label: "Casual 5" },
  { id: "outfit6", label: "Casual 6" },
  { id: "suit1", label: "Suit 1" },
  { id: "suit2", label: "Suit 2" },
  { id: "suit3", label: "Suit 3" },
  { id: "suit4", label: "Suit 4" },
];

export default function CharacterEditor({ bridge, onClose }: Props) {
  const [skin, setSkin] = useState(bridge.character.skin);
  const [hair, setHair] = useState(bridge.character.hair);
  const [outfit, setOutfit] = useState(bridge.character.outfit);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await botFetch("/api/config/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skin, hair, outfit }),
      });
      if (res.ok) {
        bridge.character.skin = skin;
        bridge.character.hair = hair;
        bridge.character.outfit = outfit;
        bridge.revision++;
        onClose();
      }
    } catch (err) {
      console.error("Failed to save character:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-medium text-foreground">Character Editor</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
      </div>

      {/* Skin */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Skin</label>
        <div className="flex gap-2">
          {SKIN_COLORS.map((color, i) => (
            <button
              key={i}
              onClick={() => setSkin(i)}
              className={`w-8 h-8 rounded-md border-2 transition-colors ${skin === i ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Hair */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Hair</label>
        <div className="grid grid-cols-4 gap-1">
          {HAIR_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => setHair(i)}
              className={`text-xs px-2 py-1.5 rounded-md transition-colors ${
                hair === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Outfit */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Outfit</label>
        <div className="grid grid-cols-2 gap-1">
          {OUTFIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setOutfit(opt.id)}
              className={`text-xs px-2 py-1.5 rounded-md transition-colors ${
                outfit === opt.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/views/office/character-editor.tsx
git commit -m "feat(office): add character editor modal (skin, hair, outfit)"
```

---

### Task 18: Add Office Tab to App

**Files:**
- Modify: `agent/dashboard/src/app.tsx`

- [ ] **Step 1: Add lazy import and Office tab**

At the top of `app.tsx`, add the lazy import:

```typescript
import { useState, useEffect, lazy, Suspense } from "react";
```

And add the lazy component:

```typescript
const OfficeView = lazy(() => import("./views/office/office-view"));
```

Change the tabs array to include Office:

```typescript
const tabs = ["Sessions", "Office", "Schedule", "Settings"] as const;
```

Add Office icon to the icons record:

```typescript
const icons: Record<Tab, string> = {
  Sessions: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  Office: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
  Schedule: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  Settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};
```

In the main content, add the Office rendering with Suspense:

```tsx
{tab === "Sessions" && <Sessions />}
{tab === "Office" && (
  <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>}>
    <OfficeView />
  </Suspense>
)}
{tab === "Schedule" && <Schedule />}
{tab === "Settings" && <Settings />}
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/src/app.tsx
git commit -m "feat(office): add Office tab to dashboard with lazy-loaded OfficeView"
```

---

## Chunk 5: Mock API & Manual Testing

### Task 19: Update Mock API

**Files:**
- Modify: `agent/dashboard/scripts/mock-api.ts`

- [ ] **Step 1: Add mock endpoints for office features**

Add to the `configureServer` method in `mock-api.ts`, after the existing `/api/logs` handler:

```typescript
      // GET /api/config/character
      server.middlewares.use("/api/config/character", (req, res) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ skin: 0, hair: 0, outfit: "outfit1" }));
      });

      // GET /api/tasks
      server.middlewares.use("/api/tasks", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
      });

      // GET /api/status/stream (SSE mock with cycling states)
      server.middlewares.use("/api/status/stream", (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Initial snapshot
        res.write(`event: snapshot\ndata: ${JSON.stringify({ activity: "idle", talkingTo: null, lastActive: new Date().toISOString() })}\n\n`);

        // Cycle through states for demo
        const states = ["idle", "thinking", "calling", "scheduled", "webhook", "error"];
        let stateIndex = 0;
        const interval = setInterval(() => {
          stateIndex = (stateIndex + 1) % states.length;
          const prev = states[(stateIndex - 1 + states.length) % states.length];
          const state = states[stateIndex];
          res.write(`event: state\ndata: ${JSON.stringify({ prev, state, talkingTo: state === "calling" ? "helper-bot" : null })}\n\n`);

          // Emit tool events when "thinking"
          if (state === "thinking") {
            setTimeout(() => {
              res.write(`event: tool\ndata: ${JSON.stringify({ name: "Read", context: "src/app.tsx" })}\n\n`);
            }, 1000);
            setTimeout(() => {
              res.write(`event: tool\ndata: ${JSON.stringify({ name: "Edit", context: "src/app.tsx" })}\n\n`);
            }, 3000);
          }
        }, 8000);

        // Heartbeat
        const heartbeat = setInterval(() => {
          res.write(`event: heartbeat\ndata: \n\n`);
        }, 30000);

        req.on("close", () => {
          clearInterval(interval);
          clearInterval(heartbeat);
        });
      });
```

- [ ] **Step 2: Commit**

```bash
git add agent/dashboard/scripts/mock-api.ts
git commit -m "feat(office): add mock API endpoints for character config and SSE state cycling"
```

---

### Task 20: Vite Proxy for SSE + New Endpoints

**Files:**
- Modify: `agent/dashboard/vite.config.ts`

- [ ] **Step 1: Verify proxy config covers /api/* routes**

The existing proxy `"/api": "http://localhost:7801"` already covers all new `/api/*` routes. No changes needed unless the SSE stream needs special handling.

Check if the Vite proxy handles SSE correctly — it should since it just proxies HTTP. No modification needed.

- [ ] **Step 2: Manual test**

```bash
cd agent/dashboard && npm run dev:mock
```

Open browser to `http://localhost:5173/dashboard/`, click the Office tab. Verify:
- Phaser canvas loads with colored rectangles for zones
- Character sprite appears at sofa position
- Status bar shows "idle"
- Character walks between zones as mock SSE cycles states
- Clicking furniture opens overlay panels
- Clicking character opens editor modal
- Clock shows current time

---

### Task 21: Build Verification

- [ ] **Step 1: Run all tests**

```bash
cd agent && npx vitest run character-config.test.ts
cd agent/dashboard && npx vitest run
```

Expected: All tests pass

- [ ] **Step 2: Run production build**

```bash
cd agent/dashboard && npm run build
```

Expected: Builds successfully. Phaser is in a separate chunk (dynamic import).

- [ ] **Step 3: Commit any fixes**

If build or tests fail, fix and commit.

---

### Task 22: Final Commit & Summary

- [ ] **Step 1: Verify git status is clean**

```bash
git status
```

- [ ] **Step 2: Tag milestone**

```bash
git tag pixel-office-v1
```

---

## Implementation Notes

### What's included in v1:
- Server: officeEvents emitter, enhanced SSE with snapshot/tool/subagent/heartbeat, error state hold (5s), character config endpoints, filtered logs
- Client: OfficeBridge type + factory, zone definitions, route table, asset manifest, tilemap data, ambient logic (plant/window/coffee), character compositing + walk animation, subagent clone manager, Phaser OfficeScene, OfficeView React wrapper with overlays + status bar, character editor modal, Office tab in app.tsx, SSE + polling status provider

### What uses placeholder visuals (to be refined with tileset):
- Floor rendering: solid colored rectangles (tileset tile indices need manual visual tuning)
- Furniture: colored squares with labels (tileset furniture tiles need mapping)
- Character sub-animations: idle alternation only (tool-specific overlays like thought bubbles need overlay sprites that don't exist yet)

### What's deferred:
- Overlay sprite creation (thought-bubble.png, speech-bubble.png, zzz.png, sparks.png, etc.) — the `overlays/` directory doesn't exist yet
- Full tilemap visual authoring with actual tileset indices
- Coffee cup sprites, plant sprite variants
- Tool-specific sub-animations at each zone
- Live preview canvas in character editor (uses button grid instead)
