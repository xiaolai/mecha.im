# Pixel Office — Design Spec

**Date**: 2026-03-13
**Branch**: `feat/pixel-office`
**Status**: Reviewed (Codex gpt-5.4)

## Overview

A pixel-art office view in the bot dashboard that visualizes bot status in real time. The bot character moves between office zones based on activity state, performs tool-specific sub-animations, and the environment reflects ambient signals (time, cost, errors). Clicking furniture opens real data overlays (sessions, schedule, etc.).

## Decisions

| Question | Choice |
|----------|--------|
| Scope | Single bot first, multi-bot extension later |
| Integration | New "Office" tab in bot dashboard |
| Office size | Small office (~512×448), 6 zones |
| Rendering | Phaser 3.90.0 embedded in React container |
| Monitor interaction | Click-to-expand overlays |
| Character | Visual editor (skin, hair, outfit) |
| Zone mapping | Hybrid: activity→zone + tool→sub-animation |
| Subagents | Translucent clone sprites |
| Environment | Light ambient (clock, coffee cups, plant, window light) |

## Architecture

### Component Boundaries

**React owns:**
- Tab routing (Office tab alongside Sessions, Schedule, Settings)
- Overlay panels triggered by furniture clicks (reuse existing ConversationViewer, ScheduleView, etc.)
- Character editor modal
- Status bar below the canvas (text summary of current state)
- SSE subscription and periodic polling
- Writing to the bridge state object

**Phaser owns:**
- Tilemap rendering (office layout from tile data)
- Character sprite compositing and animation (body + hair + outfit layers)
- Zone-to-zone routing (precomputed routes, not A*)
- Furniture click zones (interactive hitboxes)
- Ambient effects (clock hands, coffee cup count, plant state, window light tint)
- Subagent clone sprites (spawn/despawn translucent copies)
- Particle effects (error sparks, webhook alert flash)

**Phaser lazy loading:** The `OfficeView` React component is loaded via `React.lazy(() => import("./views/office/office-view"))`. Inside that component, Phaser is imported dynamically with `await import("phaser")`. Users who never open the Office tab pay zero bundle cost. A loading spinner shows while the chunk loads.

**React.StrictMode guard:** In development, StrictMode double-fires mount effects. The Phaser game instance must be created with a guard (e.g., a module-level `let game: Phaser.Game | null`) and destroyed with `game.destroy(true)` in the cleanup function. Only create if `game === null`.

### Bridge (shared state object)

```typescript
interface OfficeBridge {
  // React writes → Phaser reads in update() loop
  revision: number;  // incremented on every write — Phaser skips diffing if unchanged
  state: {
    activity: "idle" | "thinking" | "calling" | "scheduled" | "webhook" | "error";
    talkingTo: string | null;
    currentTool: string | null;
    currentToolContext: string | null;
    subagents: { id: string; type: string; description: string }[];
    currentSessionId: string | null;   // for "computer" click → open session
    taskStartedAt: string | null;
    costToday: number;
    consecutiveErrors: number;
    scheduleNextRunAt: string | null;
    ptyClientsConnected: number;
    idleSinceSec: number;
  };
  character: {
    skin: number;    // 0-5 (6 palette rows in body sheet)
    hair: number;    // 0-7
    outfit: string;  // "outfit1"-"outfit6" | "suit1"-"suit4"
  };

  // Phaser writes → React reads via callback
  onFurnitureClick: ((item: ClickableItem) => void) | null;
}

type ClickableItem = "computer" | "phone" | "printer" | "server" | "door" | "character";
```

The bridge is stored as a `useRef` in the React component (stable across renders, never recreated). React writes to it on every SSE event or poll response and increments `revision`. Phaser reads it every frame in `update()`, compares `revision` to its last-seen value, and only processes changes when they differ.

### Zone ↔ ClickableItem Mapping

| Zone Name | Character walks here when | ClickableItem at this zone | Click opens |
|-----------|--------------------------|---------------------------|-------------|
| desk | `thinking` | `computer` | Active session (ConversationViewer) |
| phone | `calling` | `phone` | Interbot call log (filtered events) |
| sofa | `idle` | *(none — sofa is not clickable)* | — |
| printer | `scheduled` | `printer` | Schedule panel (ScheduleView) |
| server | `error` | `server` | Error log (filtered events) |
| door | `webhook` | `door` | Webhook event log |
| *(any)* | *(any)* | `character` | Character editor modal |

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  Server-side changes                                    │
│                                                         │
│  1. officeEvents EventEmitter relays tool/subagent      │
│     events from SDK onEvent callback                    │
│  2. activity.transition("error") now called on task     │
│     failure, held for 5s before transitioning to idle   │
│  3. /api/status enhanced with current_session_id        │
│  4. /api/logs gains ?source= filter param               │
│  5. /api/status/stream sends initial snapshot on connect│
└─────────────────────────────────────────────────────────┘
          │
          ▼ SSE events
┌─────────────────────────────────────────────────────────┐
│  React: OfficeStatusProvider                            │
│                                                         │
│  0. Bootstrap: on SSE connect, process the initial      │
│     "snapshot" event to populate full bridge state.      │
│     Also fetch GET /api/status + /api/tasks +           │
│     /api/costs + /api/schedule for complete picture.    │
│                                                         │
│  1. Subscribe to /api/status/stream (SSE)               │
│     - "state" events → activity, talkingTo              │
│     - "tool" events → currentTool, currentToolContext   │
│     - "subagent" events → add/remove from subagents[]   │
│                                                         │
│  2. Poll every 10s (ONLY when Office tab is active):    │
│     - GET /api/costs → costToday                        │
│     - GET /api/tasks → taskStartedAt, currentSessionId  │
│     - GET /api/schedule → scheduleNextRunAt,            │
│       consecutiveErrors                                 │
│                                                         │
│  3. Derive locally:                                     │
│     - idleSinceSec: timer started when activity→"idle"  │
│     - ptyClientsConnected: from GET /api/sessions       │
│                                                         │
│  4. Write to bridge + increment bridge.revision         │
│                                                         │
│  On SSE disconnect: reconnect with exponential backoff, │
│  re-bootstrap on reconnect.                             │
│                                                         │
│  Polling stops when Office tab unmounts (useEffect      │
│  cleanup). SSE also disconnects on unmount.             │
└─────────────────────────────────────────────────────────┘
          │
          ▼ reads bridge every frame
┌─────────────────────────────────────────────────────────┐
│  Phaser: OfficeScene.update()                           │
│                                                         │
│  - Check bridge.revision vs lastSeenRevision            │
│  - If changed:                                          │
│    - On activity change → route to new zone             │
│    - On currentTool change → switch sub-animation       │
│    - On subagents change → spawn/despawn clones         │
│    - On ambient signals → update clock/coffee/plant     │
│  - If prefers-reduced-motion: skip walk animation,      │
│    teleport character to zone instantly                  │
│                                                         │
│  On furniture click:                                    │
│  - Calls bridge.onFurnitureClick("computer")            │
│  - React reads bridge.state.currentSessionId            │
│    and opens ConversationViewer for that session         │
└─────────────────────────────────────────────────────────┘
```

## Server-Side Changes

### Error State in Activity Tracker

Currently, task errors transition directly back to `idle`. Change to:

```typescript
// In server.ts error handling path:
activity.transition("error");
setTimeout(() => {
  if (activity.getState() === "error") {
    activity.transition("idle");
  }
}, 5000);  // Hold error state for 5 seconds so the office can show it
```

This gives the pixel office time to animate the character walking to the server rack and showing the error animation before returning to idle.

### Enhanced SSE Stream (`/api/status/stream`)

Currently subscribes only to `activity.on("change")`. Add:

```typescript
// 1. Create a shared EventEmitter for office events
const officeEvents = new EventEmitter();

// 2. In the SDK query() onEvent callback:
onEvent: (event) => {
  if (event.type === "tool_use") {
    const toolContext = formatToolLabel(event.data.tool, event.data.input);
    officeEvents.emit("tool", { name: event.data.tool, context: toolContext });

    // Detect subagent spawn — use toolUseId as stable correlation ID
    if (event.data.tool === "Agent") {
      const input = event.data.input as Record<string, unknown>;
      officeEvents.emit("subagent", {
        action: "spawn",
        id: event.data.toolUseId,  // stable ID from SDK, not random
        type: String(input.subagent_type ?? "general"),
        description: String(input.description ?? ""),
      });
    }
  }
  // Detect subagent completion — match by toolUseId
  if (event.type === "tool_result") {
    if (event.data.toolUseId) {
      officeEvents.emit("subagent", {
        action: "complete",
        id: event.data.toolUseId,
      });
    }
  }
}

// 3. In /api/status/stream handler:

// Send initial snapshot on connect (bootstrap)
const snapshot = {
  activity: activity.getState(),
  talkingTo: activity.getTalkingTo(),
  lastActive: activity.getLastActive(),
};
writer.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

// Then subscribe to deltas:
activity.on("change", (data) => {
  writer.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
});
officeEvents.on("tool", (data) => {
  writer.write(`event: tool\ndata: ${JSON.stringify(data)}\n\n`);
});
officeEvents.on("subagent", (data) => {
  writer.write(`event: subagent\ndata: ${JSON.stringify(data)}\n\n`);
});

// Heartbeat every 30s to detect dead connections
const heartbeat = setInterval(() => {
  writer.write(`: heartbeat\n\n`);
}, 30_000);
// Clean up on disconnect:
// clearInterval(heartbeat); remove all listeners
```

### Enhanced `/api/status`

Add `current_session_id` to the existing response:

```typescript
// In GET /api/status handler:
{
  name, state, model, uptime, current_task, talking_to, last_active,
  current_session_id: sessions.getActiveTask()?.session_id ?? null,  // NEW
}
```

### Filtered Event Log

Add `?source=` query parameter to `GET /api/logs`:

```typescript
// GET /api/logs?limit=50&source=interbot
// GET /api/logs?limit=50&source=webhook
// GET /api/logs?limit=50&source=error
// Filters events by matching the source/type field
```

### New Endpoints

```typescript
// Character config — stored in $MECHA_STATE_DIR/character.json
GET  /api/config/character
  Response: { skin: number, hair: number, outfit: string }
  Default (file missing): { skin: 0, hair: 0, outfit: "outfit1" }

POST /api/config/character
  Body: { skin: number, hair: number, outfit: string }
  Validates: skin 0-5, hair 0-7, outfit matches /^(outfit[1-6]|suit[1-4])$/
  Writes to: $MECHA_STATE_DIR/character.json
  Response: { ok: true }
```

## File Structure

```
agent/dashboard/
├── public/pixel-assets/          # Already exists
│   ├── office-tileset/           # Donarg tileset (16/32/48px)
│   ├── metrocity/                # Character sprites
│   ├── metrocity-2.0/            # Suit overlays
│   └── metrocity-2.1/            # Building sprites
│
├── src/
│   ├── app.tsx                   # Add "Office" to tabs array + icon
│   ├── views/
│   │   └── office/
│   │       ├── office-view.tsx       # React wrapper: lazy Phaser, overlays, status bar
│   │       ├── office-bridge.ts      # OfficeBridge type + useRef factory
│   │       ├── office-status.ts      # SSE subscription + polling → writes bridge
│   │       ├── office-scene.ts       # Phaser Scene: preload, create, update
│   │       ├── asset-manifest.ts     # Explicit map of logical names → actual file paths
│   │       ├── character.ts          # Character: compositing, animation state machine
│   │       ├── routes.ts            # Precomputed route table between 6 zones
│   │       ├── tilemap-data.ts       # Office layout as tile index array (hand-authored)
│   │       ├── zones.ts             # Zone definitions: position, furniture, hitbox
│   │       ├── ambient.ts           # Clock, coffee, plant, window light logic
│   │       ├── subagent-clones.ts   # Clone sprite manager (spawn/despawn/fade)
│   │       └── character-editor.tsx  # React modal: skin/hair/outfit picker
│   │
│   └── lib/
│       └── api.ts                # Existing botFetch + new SSE helper
│
agent/
├── server.ts                     # officeEvents emitter, enhanced SSE, character endpoints
└── character-config.ts           # Read/write $MECHA_STATE_DIR/character.json
```

## Office Layout

Small office, ~16×14 tiles at 32×32px = 512×448px canvas.

Phaser config: `pixelArt: true`, `antialias: false`, `roundPixels: true`, fixed internal resolution 512×448, scaled with `Scale.FIT` mode. Integer scaling for HiDPI/retina displays.

```
┌──────────────────────────────────┐
│ [window]     [clock]    [window] │
│                                  │
│  ┌─────────┐       ┌────────┐   │
│  │ Server  │       │ Phone  │   │
│  │ Rack    │       │ Area   │   │
│  └─────────┘       └────────┘   │
│                                  │
│        ┌──────────────┐          │
│        │  Desk +      │          │
│        │  Computer    │          │
│        │  [chair]     │          │
│        └──────────────┘          │
│                                  │
│  ┌─────────┐       ┌────────┐   │
│  │ Printer │       │ Sofa + │   │
│  │ + Files │       │ Coffee │   │
│  └─────────┘       └────────┘   │
│                                  │
│         [door / mailbox]         │
└──────────────────────────────────┘
```

**Zone positions** (tile coordinates, 32px grid):

| Zone ID | Tiles | Furniture | Activity trigger |
|---------|-------|-----------|------------------|
| `desk` | (7,7) | Desk, monitor, chair, keyboard | `thinking` |
| `phone` | (12,4) | Wall phone, contact board | `calling` |
| `sofa` | (12,11) | Sofa, coffee machine, side table | `idle` |
| `printer` | (2,11) | Printer, file cabinet | `scheduled` |
| `server` | (2,4) | Server rack, cables, warning light | `error` |
| `door` | (7,13) | Door, mailbox/package area | `webhook` |

The desk is central. All zones reachable within 4-8 tiles.

### Routing

**Precomputed route table**, not A*. For 6 zones on a 16×14 grid, we store 30 routes (6×5 zone pairs) as arrays of tile coordinates. Generated once during development, stored in `routes.ts` as a static lookup:

```typescript
const ROUTES: Record<string, [number, number][]> = {
  "desk→phone": [[7,7], [8,6], [9,5], [10,4], [12,4]],
  "desk→sofa":  [[7,7], [8,8], [9,9], [10,10], [12,11]],
  // ... all 30 pairs
};
```

If future versions need dynamic routing (multi-bot collision avoidance, layout editor), upgrade to BFS at that point.

## Character System

### Asset Manifest

All sprite paths are mapped in `asset-manifest.ts` to avoid string concatenation with space-containing filenames:

```typescript
export const ASSETS = {
  body: "/dashboard/pixel-assets/metrocity/CharacterModel/Character Model.png",
  shadow: "/dashboard/pixel-assets/metrocity/CharacterModel/Shadow.png",
  hairs: "/dashboard/pixel-assets/metrocity/Hair/Hairs.png",
  outfit1: "/dashboard/pixel-assets/metrocity/Outfits/Outfit1.png",
  outfit2: "/dashboard/pixel-assets/metrocity/Outfits/Outfit2.png",
  // ... all outfits
  suit: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",
  tileset32: "/dashboard/pixel-assets/office-tileset/Office Tileset All 32x32.png",
  // overlay sprites (created for this feature):
  thoughtBubble: "/dashboard/pixel-assets/overlays/thought-bubble.png",
  speechBubble: "/dashboard/pixel-assets/overlays/speech-bubble.png",
  zzz: "/dashboard/pixel-assets/overlays/zzz.png",
  sparks: "/dashboard/pixel-assets/overlays/sparks.png",
  paper: "/dashboard/pixel-assets/overlays/paper.png",
  phone: "/dashboard/pixel-assets/overlays/phone-handset.png",
  coffeeCup: "/dashboard/pixel-assets/overlays/coffee-cup.png",
  // plant variants:
  plantHealthy: "/dashboard/pixel-assets/overlays/plant-healthy.png",
  plantDrooping: "/dashboard/pixel-assets/overlays/plant-drooping.png",
  plantWilted: "/dashboard/pixel-assets/overlays/plant-wilted.png",
  plantDead: "/dashboard/pixel-assets/overlays/plant-dead.png",
} as const;
```

### Sprite Sheet Layout (verified by Codex review)

The body sheet (`Character Model.png`, 768×192) contains:

- **24 columns × 6 rows** of 32×32 frames
- **6 rows are palette/color recolors** — NOT 3 skin tones × 2 pose rows. Each row is a distinct character color variant. `skin` index 0-5 maps directly to row 0-5.
- **Direction strips within each row**: 4 directions × 6 frames = 24 columns
  - The direction order needs **in-engine verification** during implementation. Codex review indicates it is `front, side, back, mirrored-side` — not `down, left, right, up`.
  - Implementation must test each 6-frame strip and map to `{ down, left, right, up }` based on visual inspection.
  - `left` and `right` may be the same strip with `flipX = true`.

The hair sheet (`Hairs.png`, 768×256) has **reversed row order** relative to the individual Hair preview files:
- Row 0 = `Hair7.png` appearance, Row 7 = `Hair.png` appearance
- The `hair` config index 0-7 maps to sheet rows, but the character editor preview must show them in visual order (row 7 first).

Outfit sheets (`Outfit1-6.png`, 768×32 each) and suit sheet (`Suit.png`, 768×128) share the same 24-column layout.

All layers are composited by rendering them at the same position with matching frame indices.

### Animation State Machine

```
   ┌────────────────┐   state.activity
   │                │   changed
   │   IDLE         │──────────────┐
   │   (at zone)    │              │
   │                │◄──┐          ▼
   │  Sub-anims     │   │   ┌────────────┐
   │  driven by     │   │   │  WALKING   │
   │  currentTool   │   │   │  (to zone) │
   │                │   │   │            │
   └────────────────┘   │   │  6-frame   │
                        │   │  walk cycle│
                        │   └────┬───────┘
                        │        │ arrived
                        └────────┘
```

**Walking**: 6-frame walk cycle, direction set by route vector. Speed: 2 tiles/second (~64px/s).

**Reduced motion**: If `prefers-reduced-motion` media query matches, skip walk animation entirely — teleport character to target zone position instantly.

**Idle sub-animations at zone**:

| At Zone | Tool / Signal | Sub-animation |
|---------|--------------|---------------|
| desk | `thinking` (no tool yet) | Chin on hand, thought bubble with `...` |
| desk | `Read` / `Grep` / `Glob` | Holds paper, examining |
| desk | `Edit` / `Write` | Typing on keyboard, monitor active |
| desk | `Bash` | Terminal green text on monitor |
| desk | `WebSearch` / `WebFetch` | Globe icon on monitor |
| desk | `Agent` (spawns subagent) | Points outward, clone materializes |
| phone | `mecha_call` | Holding phone, speech bubble with `talkingTo` name |
| phone | `mecha_list` | Flipping through directory on wall |
| sofa | idle, `idleSinceSec` < 120 | Sitting on sofa, relaxed |
| sofa | idle, `idleSinceSec` 120-600 | Stretching, yawning (cycle every 30s) |
| sofa | idle, `idleSinceSec` > 600 | Sleeping with `Zzz` bubble |
| printer | any tool during `scheduled` | Collecting papers from printer |
| door | any tool during `webhook` | Receiving package, opening mail |
| server | error, `consecutiveErrors` ≤ 3 | Examining server, sparks flying |
| server | error, `consecutiveErrors` > 3 | Head-on-desk, frustration marks |

Sub-animations are composed from existing walk frames (character facing furniture direction) + small overlay sprites. No new character sprite sheets needed.

### Character Editor

React modal triggered by clicking the character sprite or a toolbar button.

- Live preview: Canvas rendering composited character at 3× scale (96×96)
- Skin selector: 6 options (one per body sheet row)
- Hair selector: grid of 8 (shown in visual order, mapping to reversed sheet rows)
- Outfit selector: grid of 10 (6 casual + 4 suits)
- Save: `POST /api/config/character`
- Load: `GET /api/config/character`

## Subagent Clone System

When the bot spawns subagents, translucent clone sprites appear:

1. SSE `subagent` event with `action: "spawn"` → React adds to `bridge.state.subagents[]` using `toolUseId` as stable ID
2. Phaser spawns clone: same appearance, 50% alpha, positioned at desk zone (offset 16px per clone to avoid overlap), floating label with subagent type
3. SSE `subagent` event with `action: "complete"` (same `toolUseId`) → React removes from subagents[]
4. Phaser fades clone out over 500ms

**Max visible**: 5 clones. Overflow shows `+N` badge.

**Graceful degradation**: If the server doesn't emit `subagent` events (older version), the feature is simply absent.

## Ambient Environment

### Clock (wall)
- Browser local time, updating every 60s
- Phaser Graphics: circle + 2 rotating lines

### Coffee Cups (side table)
- Ephemeral client-side counter (resets on reload)
- +1 each time activity transitions from `idle` to non-idle
- Max 5 visible (then stacked sprite). Resets after 30min idle.

### Plant (shelf)
- Derived from `consecutiveErrors`: 0=healthy, 1-2=drooping, 3-4=wilted, 5+=dead
- 4 pre-made 32×32 plant sprites

### Window Light
- Tint based on local hour: morning yellow, midday clear, evening orange, night blue+stars

## Furniture Click Zones

| ClickableItem | Furniture Sprite | React Overlay |
|---------------|-----------------|---------------|
| `computer` | Monitor on desk | ConversationViewer for `currentSessionId` |
| `phone` | Wall phone | Event log via `GET /api/logs?source=interbot` |
| `printer` | Printer + cabinet | ScheduleView (existing component) |
| `server` | Server rack | Event log via `GET /api/logs?source=error` |
| `door` | Door + mailbox | Event log via `GET /api/logs?source=webhook` |
| `character` | The character sprite | Character editor modal |

Sofa is **not clickable**.

Overlays: absolutely-positioned React panels above Phaser canvas. Dismissed by click-outside or Escape.

## Status Bar

```
[●] thinking · editing src/app.ts · 2m 34s · $0.03 today
```

- Status dot: green=idle, yellow=thinking, blue=calling, purple=scheduled, orange=webhook, red=error
- Activity label
- Tool context (via `formatToolLabel`)
- Task duration (live timer from `taskStartedAt`)
- Cost today

Idle: `[●] idle · last active 5m ago`

## Asset Loading & Error Handling

### Preload
Phaser `preload()` loads all assets from the manifest. Loading bar shown in scene.

### Missing Assets
- Console warning, colored rectangle placeholder via Phaser `Graphics`
- Scene still renders — allows iterative development

### Phaser Load Failure
- React wrapper shows: "Failed to load Pixel Office. [Retry]"

### Visibility Pause
- When browser tab is hidden (`document.hidden`), Phaser scene pauses to save CPU
- Resumes on visibility change

## Dependencies

```json
{
  "phaser": "3.90.0"
}
```

Pinned version (not caret range). Matches official Phaser React template. Dynamically imported — not in main bundle.

## Testing Strategy

- **Unit tests** (vitest): Route table correctness, zone mapping (activity→zone ID), bridge state parsing, asset manifest completeness
- **Visual manual**: Phaser scene rendering, character walk, furniture clicks, overlay positioning
- **Integration**: Mock SSE in `mock-api.ts` emitting state/tool/subagent events on a timer
- **Character editor**: Layer compositing (correct frame indices for skin/hair/outfit)
- **Ambient**: Manual verification of clock, coffee, plant, window tint
- **Accessibility**: `prefers-reduced-motion` disables walk animation

## Out of Scope (v1)

- Multi-bot shared office (v2)
- Sound effects
- Mobile/touch optimization
- Office layout editor (hand-authored tilemap)
- Saving/loading furniture arrangement
- Chat bubbles with actual message text
- Custom overlay sprites for every tool (v1 uses monitor tint + generic overlays)
- Keyboard navigation within canvas (v2 — add ARIA labels on overlay triggers)
