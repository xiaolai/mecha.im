# Pixel Office — Real-Time Bot Activity Visualization

**Date**: 2026-03-11
**Status**: Approved

## Overview

A pixel art virtual office visualization layer for the mecha dashboard. Bots appear as NPC characters that move between rooms based on real-time activity state, inspired by [OpenClawfice](https://openclawfice.com). Built as a new `/office` route in the existing Vite + React Router SPA (`packages/spa`).

## Goals

1. Surface real-time bot activity (idle, thinking, tool use, responding) as visual NPC behavior
2. Provide click-to-inspect for live tool calls and session info
3. Support quest markers for pending decisions (errors, budget warnings)
4. Enable DM (direct message) to individual bots from the office view
5. Fun water cooler visualization of recent bot activity

## Non-Goals

- Replacing the existing dashboard (this is an additional view)
- Actual inter-bot communication protocol (already exists via `mesh_query`)
- Character sprite creation (user provides assets)
- Mobile-first layout (desktop visualization, responsive is a stretch goal)

## CLI-First Compliance

The office view itself is a pure UI visualization (exempt per `no-gui-without-cli.md`). However, the underlying activity events backend (Phases 1-2) must have a CLI equivalent:

- **New CLI command: `mecha bot activity [name] [--watch]`** — tails the activity SSE stream from a bot or the daemon
- Implemented in `packages/cli/src/commands/bot-activity.ts` before any frontend work
- `--watch` mode streams events in real time; without it, shows current snapshot

## Architecture

```
┌─────────────────────────────────────────────────┐
│  SPA (/office)                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  OfficeCanvas (HTML5 Canvas)                │ │
│  │  ├─ TileMap (32x32 Donarg tileset)          │ │
│  │  ├─ BotSprites (NPC characters)             │ │
│  │  ├─ ActivityManager (state machine)         │ │
│  │  └─ InteractionLayer (click, DM, quests)    │ │
│  └──────────────┬──────────────────────────────┘ │
│                 │ EventSource                     │
│                 ▼                                 │
│  ┌──────────────────────────────┐                │
│  │  Daemon GET /events (SSE)   │                │
│  │  Unified stream:            │                │
│  │  - ProcessEvent (lifecycle) │                │
│  │  - ActivityEvent (per-bot)  │                │
│  └──────────┬───────────────────┘                │
│             │ ActivityAggregator                  │
│             ▼                                     │
│  ┌──────────────────────────────┐                │
│  │  Bot Runtime GET /api/events │  (per bot)     │
│  │  SSE stream of SDK events    │                │
│  │  mapped to ActivityEvent     │                │
│  └──────────────────────────────┘                │
└─────────────────────────────────────────────────┘
```

## Activity Event Model

### Activity States

```typescript
type ActivityState =
  | "idle"        // No active query — bot in lounge
  | "thinking"    // SDK query started, waiting for first response
  | "tool_use"    // Bot is executing a tool (Bash, Edit, Read, etc.)
  | "responding"  // Bot is streaming a text response
  | "subagent"    // Bot spawned a subagent task
  | "waiting"     // Rate limited, waiting for capacity
  | "error";      // Query failed
```

### ActivityEvent Type

```typescript
interface ActivityEvent {
  botName: string;
  activity: ActivityState;
  toolName?: string;       // Present when activity === "tool_use"
  sessionId?: string;      // Active session ID
  timestamp: string;       // ISO 8601
}
```

### SDK Event → Activity State Mapping

| SDK Event Type | Activity State |
|---|---|
| `system` (subtype: `init`) | `thinking` |
| `system` (subtype: `status`) | `thinking` |
| `stream_event` | `responding` |
| `assistant` | `responding` |
| `tool_progress` / `tool_use_summary` | `tool_use` (with `toolName`) |
| `system` (subtype: `task_started` / `task_progress`) | `subagent` |
| `rate_limit_event` | `waiting` |
| `result` (success) | `idle` |
| `result` (error) | `error` → `idle` (after brief display) |
| No active query | `idle` |

### State Transitions

```
idle → thinking → tool_use → responding → idle
                    ↕            ↕
                  subagent    tool_use
                    ↓
                  error → idle (after 5s display)

waiting can interrupt any active state
```

## Backend Changes

### Package: `packages/runtime`

#### New: `src/activity.ts`

- `ActivityEmitter` class (mirrors `ProcessEventEmitter` pattern)
- `subscribe(handler) → unsubscribe` API
- `emit(event: ActivityEvent)` method
- Scoped per bot runtime instance (not global)

#### Modified: `src/sdk-chat.ts`

Currently `sdkChat()` discards all non-`result` events in the `for await...of` loop. This change adds inspection of additional event types without changing the return value.

- Accept optional `ActivityEmitter` parameter
- Emit activity transitions as SDK events arrive (using SDK type discriminants from `sdk.d.ts`):
  - On function entry: emit `{ activity: "thinking" }`
  - On `tool_progress` / `tool_use_summary`: emit `{ activity: "tool_use", toolName }`
  - On `stream_event` / `assistant`: emit `{ activity: "responding" }`
  - On `system.task_started`: emit `{ activity: "subagent" }`
  - On `rate_limit_event`: emit `{ activity: "waiting" }`
  - On `result` success: emit `{ activity: "idle" }`
  - On error: emit `{ activity: "error" }`, then after result emit `{ activity: "idle" }`
- Debounce rapid transitions (no duplicate consecutive states)

#### New: `src/routes/events.ts` (bot-level)

- `GET /api/events` SSE endpoint on bot runtime
- Streams `ActivityEvent` objects
- Heartbeat every 10s
- Max 5 connections per bot
- Uses `request.socket.on("close")` for disconnect detection (per AGENTS.md)
- Uses `reply.hijack()` to bypass Fastify response handling

#### Modified: `src/server.ts`

- Create `ActivityEmitter` instance
- Pass to `sdkChat()` via `httpChatFn` closure
- Pass to new events route registration

### Package: `packages/agent`

#### New: `src/activity-aggregator.ts`

- Manages SSE connections to each running bot's `/api/events` using `eventsource-parser` (lightweight streaming fetch parser — Node.js has no native `EventSource`)
- On bot spawn: open SSE connection with bearer token auth via `fetch()` + streaming body
- On bot stop: abort the fetch connection
- Re-emit received `ActivityEvent` via a separate `ActivityEventEmitter` (same pattern as `ProcessEventEmitter`)
- Daemon SSE route subscribes to both emitters and serializes both types into the unified stream
- Reconnect with exponential backoff on disconnect (1s, 2s, 4s, max 30s)
- Clean up all connections on daemon shutdown

#### Modified: `src/routes/events.ts` (daemon-level)

- Extended to emit both `ProcessEvent` and `ActivityEvent` types
- Unified SSE stream format:

```typescript
// Lifecycle events (existing)
{ type: "spawned", name: "alice", pid: 123, port: 7700 }
{ type: "stopped", name: "alice", exitCode: 0 }

// Activity events (new)
{ type: "activity", name: "alice", activity: "thinking", sessionId: "abc-123", timestamp: "..." }
{ type: "activity", name: "alice", activity: "tool_use", toolName: "Bash", timestamp: "..." }
{ type: "activity", name: "alice", activity: "idle", timestamp: "..." }
```

### Package: `packages/process`

**No changes to `ProcessEvent`** — lifecycle events and activity events are separate concerns. `ProcessEvent` stays unchanged. The daemon's SSE route multiplexes both event types at the serialization boundary only.

### Type Separation

```typescript
// packages/process/src/events.ts — UNCHANGED
type ProcessEvent = { type: "spawned" } | { type: "stopped" } | { type: "error" } | { type: "warning" };

// packages/runtime/src/activity.ts — NEW
type ActivityEvent = { type: "activity"; botName: string; activity: ActivityState; ... };

// packages/agent/src/routes/events.ts — MULTIPLEXED at SSE serialization
type DaemonSSEEvent = ProcessEvent | ActivityEvent;
```

## Frontend Design

### New SPA Route: `/office`

Inside `packages/spa`, new page at `src/pages/office.tsx`. Add `<Route path="office" element={<OfficePage />} />` inside `DashboardLayout` in `src/app.tsx`. Add `/office` entry to the sidebar. Canvas components go in `src/components/office/`.

### Canvas Architecture

```
OfficeCanvas
├─ TileMap
│  - Renders office background from 32x32 Donarg tileset
│  - Office Level 3 layout: work room (left) + lounge (right)
│  - Static layer (rendered once, cached)
│
├─ BotSprites
│  - Each bot = NPC character sprite
│  - Position determined by activity state:
│    - Work Room desks (assigned by spawn order)
│    - Lounge couches (idle bots)
│    - Water cooler (2+ idle bots)
│  - Walk animation between positions (A* or simple linear interpolation)
│  - State-specific animations (typing, thinking bubble, error flash)
│
├─ ActivityManager
│  - Consumes SSE events from daemon
│  - Maintains per-bot state: { activity, position, targetPosition, toolName, sessionId }
│  - Triggers NPC movement and animation changes
│  - Handles state debouncing (don't move for <500ms state changes)
│
├─ BubbleRenderer
│  - Thought bubbles (thinking state)
│  - Speech bubbles (responding, water cooler chat)
│  - Tool icons (tool_use — shows tool name)
│  - Error/quest markers (floating above NPC)
│
└─ InteractionLayer
   - Click detection (hit test against NPC bounding boxes)
   - Click bot → slide-in inspect panel:
     - Name, current activity, tool name
     - Session ID, duration, cost
     - "Send Message" input (DM via /api/chat)
     - "View Logs" / "Stop Bot" actions
   - Quest markers → action dialogs:
     - Error quest → restart button
     - Budget quest → increase limit
```

### Room Layout (Office Level 3 based)

```
┌────────────────────────────────────────┐
│ ☕ Water Cooler        🕐 Clock        │
│                                        │
│  🖥️ Desk 1    🖥️ Desk 2    ║  🛋️     │
│                              ║  Lounge │
│  🖥️ Desk 3    🖥️ Desk 4    ║  🛋️     │
│                              ║         │
│  🖥️ Desk 5    🖥️ Desk 6    ║  🌱     │
│                              ║         │
│  ═══════ Door ═══════════════╝         │
└────────────────────────────────────────┘
```

- 6 desk positions (expandable)
- Lounge area with couches
- Water cooler zone (top left)
- Bots assigned desks by spawn order; overflow bots (7+) rendered as standing NPCs along the bottom wall
- Optimized for up to 12 bots; beyond that, a summary count badge shows "+N more" without individual sprites
- Canvas uses `requestAnimationFrame` with dirty rect tracking for performance

### NPC Behavior

| Activity State | Position | Animation |
|---|---|---|
| `idle` | Lounge couch or water cooler | Sitting, occasional fidget |
| `thinking` | Assigned desk | Sitting, thought bubble with `...` |
| `tool_use` | Assigned desk | Typing, tool icon floating above |
| `responding` | Assigned desk | Typing fast, speech bubble |
| `subagent` | Assigned desk | Mini NPC appears beside them |
| `waiting` | Assigned desk | Foot tapping, clock icon |
| `error` | Assigned desk | Red `!` marker, error bubble |

### Quest System

Quests are floating markers over bots that need human attention:

| Quest Type | Trigger | Icon | Action |
|---|---|---|---|
| Error | `activity: "error"` or `ProcessEvent: "error"` | Red `!` | Restart bot dialog |
| Budget Warning | `costToday > 0.8 * maxBudgetUsd` (polled from `GET /bots` enriched data, not SSE) | Yellow `!` | Increase budget dialog |
| Stopped | `ProcessEvent: "stopped"` unexpectedly | Orange `?` | Restart or remove |

### Water Cooler Chat

When 2+ bots are idle simultaneously:
- They walk to the water cooler area
- Speech bubbles show snippets of their last completed task
- Sourced from last `ActivityEvent` result (activity manager caches the last completed tool/response per bot)
- Pure visualization — no actual inter-bot API calls

### DM (Direct Message)

- Click bot → inspect panel → "Send Message" input
- Sends `POST /bots/{name}/query` to daemon (existing route in `packages/agent/src/routes/routing.ts`, proxies to bot's `/api/chat`)
- Response appears as speech bubble over the bot NPC
- Bot transitions: idle → thinking → responding → idle (visible in real time)

## Assets

### Available

- **Office Tileset (Donarg)** — 32x32 tiles: desks, chairs, computers, bookshelves, whiteboards, couches, plants, water cooler, vending machines, doors, windows, clocks
- **Pre-designed Office Levels** — Level 1 (small), Level 3 (full office with 6 workstations + lounge)
- **MetroCity + Interior** — .rar archives (character sprites, additional environments, need extraction)

### Needed

- Character sprite sheets for bot NPCs (walk cycles, sit, type, idle animations)
- 4-direction walk cycle (down, up, left, right) at 32x32
- User to extract .rar files and confirm which character sprites to use

## Testing Strategy

### Backend Tests

| File | Tests |
|---|---|
| `packages/runtime/__tests__/activity.test.ts` | ActivityEmitter subscribe/emit/unsubscribe, listener isolation |
| `packages/runtime/__tests__/routes/events.test.ts` | SSE endpoint, heartbeat, max connections, disconnect cleanup |
| `packages/runtime/__tests__/sdk-chat-activity.test.ts` | sdkChat emits correct activity transitions for each SDK event type |
| `packages/agent/__tests__/activity-aggregator.test.ts` | EventSource management, reconnect, cleanup on bot stop |
| `packages/process/__tests__/events.test.ts` | Extended ProcessEvent type includes activity events |

### Frontend Tests

| File | Tests |
|---|---|
| `packages/spa/__tests__/office/activity-manager.test.ts` | State machine transitions, debouncing |
| `packages/spa/__tests__/office/sse-consumer.test.ts` | EventSource mock, reconnection |

## Implementation Phases

### Phase 0: Asset Preparation

- Extract .rar files (MetroCity, Interior) for character sprites
- User selects character sprite sheets for bot NPCs
- Prepare sprite atlas: 4-direction walk cycle + sit + type + idle at 32x32

### Phase 1: Activity Events (Backend) + CLI

- `ActivityEmitter` in `packages/runtime`
- Modify `sdkChat()` to emit activity events
- Bot runtime `GET /api/events` SSE endpoint
- CLI command: `mecha bot activity [name] [--watch]`
- Tests for all above

### Phase 2: Daemon Aggregation (Backend)

- `ActivityAggregator` in `packages/agent`
- Enhanced daemon `GET /events` with unified stream
- Extended `ProcessEvent` type
- Tests for aggregation

### Phase 3: Office Canvas (Frontend)

- `/office` route in SPA
- TileMap renderer with Donarg tileset
- BotSprite renderer with walk/sit animations
- ActivityManager consuming SSE (with exponential backoff reconnect: 1s, 2s, 4s, max 30s)
- Basic NPC positioning (desk vs lounge)

### Phase 4: Interactions (Frontend)

- Click-to-inspect panel
- DM (send message to bot)
- Quest markers (error, budget)
- Context menu actions

### Phase 5: Polish

- Water cooler chat visualization
- Thought/speech bubble animations
- Smooth NPC pathfinding
- Sound effects (optional chiptune)
- Responsive layout adjustments
