# Pixel Office — Design Spec

**Date**: 2026-03-13
**Branch**: `feat/pixel-office`
**Status**: Draft

## Overview

A pixel-art office view in the bot dashboard that visualizes bot status in real time. The bot character moves between office zones based on activity state, performs tool-specific sub-animations, and the environment reflects ambient signals (time, cost, errors). Clicking furniture opens real data overlays (sessions, schedule, etc.).

## Decisions

| Question | Choice |
|----------|--------|
| Scope | Single bot first, multi-bot extension later |
| Integration | New "Office" tab in bot dashboard |
| Office size | Small office (~512×448), 6 zones |
| Rendering | Phaser 3 embedded in React container |
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
- Pathfinding between zones (A* on walkable tile grid)
- Furniture click zones (interactive hitboxes)
- Ambient effects (clock hands, coffee cup count, plant state, window light tint)
- Subagent clone sprites (spawn/despawn translucent copies)
- Particle effects (error sparks, webhook alert flash)

**Phaser lazy loading:** The Office tab dynamically imports Phaser via `React.lazy()` + `import("phaser")`. Users who never open the Office tab pay zero bundle cost. A loading spinner shows while Phaser initializes (~1MB).

### Bridge (shared state object)

```typescript
interface OfficeBridge {
  // React writes → Phaser reads in update() loop
  state: {
    activity: "idle" | "thinking" | "calling" | "scheduled" | "webhook" | "error";
    talkingTo: string | null;
    currentTool: string | null;
    currentToolContext: string | null;  // file path, command, search query
    subagents: { id: string; type: string; description: string }[];
    taskStartedAt: string | null;      // ISO timestamp of active task start
    costToday: number;
    consecutiveErrors: number;         // from scheduler state
    scheduleNextRunAt: string | null;
    ptyClientsConnected: number;
    idleSinceSec: number;              // seconds since last non-idle activity
  };
  character: {
    skin: number;    // 0-2
    hair: number;    // 0-7
    outfit: string;  // "outfit1"-"outfit6" | "suit1"-"suit4"
  };

  // Phaser writes → React reads via callback
  onFurnitureClick: ((zone: ClickableItem) => void) | null;
}

// Clickable items in the scene — distinct from zones
type ClickableItem = "computer" | "phone" | "printer" | "server" | "door" | "character";
```

The bridge is a plain object (not reactive). React writes to it on every SSE event or poll response. Phaser reads it every frame in `update()` and drives animation state changes. This avoids coupling Phaser to React's render cycle.

### Zone ↔ ClickableItem Mapping

Zones are where the character walks. ClickableItems are interactive furniture. They overlap but are not the same:

| Zone Name | Character walks here when | ClickableItem at this zone | Click opens |
|-----------|--------------------------|---------------------------|-------------|
| desk | `thinking` | `computer` | Active session (ConversationViewer) |
| phone | `calling` | `phone` | Interbot call log (filtered events) |
| sofa | `idle` | *(none — sofa is not clickable)* | — |
| printer | `scheduled` | `printer` | Schedule panel (ScheduleView) |
| server | `error` | `server` | Error log (filtered events) |
| door | `webhook` | `door` | Webhook event log |
| *(any)* | *(any)* | `character` | Character editor modal |

The calendar was removed — the printer click already opens the schedule, and a wall calendar would be redundant.

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  Server-side changes needed                             │
│                                                         │
│  ActivityTracker.transition() already emits "change"    │
│  events to SSE. We add an EventEmitter on the server:   │
│                                                         │
│  officeEvents.emit("tool", { name, context })           │
│    ← called in server.ts onEvent callback when          │
│      SDK emits tool_use events during runClaude()       │
│                                                         │
│  officeEvents.emit("subagent", { action, id, type })    │
│    ← called when tool_use has name="Agent" (spawn)      │
│    ← called when tool_result follows Agent (complete)   │
│                                                         │
│  /api/status/stream subscribes to both                  │
│  activity.on("change") AND officeEvents                 │
└─────────────────────────────────────────────────────────┘
          │
          ▼ SSE events
┌─────────────────────────────────────────────────────────┐
│  React: OfficeStatusProvider                            │
│                                                         │
│  1. Subscribe to /api/status/stream (SSE)               │
│     - "state" events → bridge.state.activity,           │
│       bridge.state.talkingTo                            │
│     - "tool" events → bridge.state.currentTool,         │
│       bridge.state.currentToolContext                   │
│     - "subagent" events → add/remove from               │
│       bridge.state.subagents[]                          │
│                                                         │
│  2. Poll every 10s (ONLY when Office tab is active):    │
│     - GET /api/costs → bridge.state.costToday           │
│     - GET /api/tasks → bridge.state.taskStartedAt       │
│       (from active task's started_at field)             │
│     - GET /api/schedule → bridge.state.scheduleNextRunAt│
│       (earliest nextRunAt from active entries),          │
│       bridge.state.consecutiveErrors                    │
│       (max consecutiveErrors across all entries)        │
│                                                         │
│  3. Derive locally:                                     │
│     - idleSinceSec: timer started when activity→"idle", │
│       reset when activity changes to non-idle           │
│     - ptyClientsConnected: from GET /api/sessions       │
│       (count sessions where hasPty=true)                │
│                                                         │
│  4. Write all values to OfficeBridge.state              │
│                                                         │
│  Polling stops when Office tab is unmounted             │
│  (cleanup in useEffect return)                          │
└─────────────────────────────────────────────────────────┘
          │
          ▼ reads bridge every frame
┌─────────────────────────────────────────────────────────┐
│  Phaser: OfficeScene.update()                           │
│                                                         │
│  - Compares bridge.state to previous frame snapshot     │
│  - On activity change → pathfind to new zone            │
│  - On currentTool change → switch sub-animation         │
│  - On subagents change → spawn/despawn clone sprites    │
│  - On ambient signals → update clock/coffee/plant       │
│                                                         │
│  On furniture click:                                    │
│  - Calls bridge.onFurnitureClick("computer")            │
│  - React opens overlay panel                            │
└─────────────────────────────────────────────────────────┘
```

## Server-Side Changes

### Enhanced SSE Stream (`/api/status/stream`)

Currently subscribes only to `activity.on("change")`. Add:

```typescript
// In server.ts — the runClaude / SDK execution path

// 1. Create a shared EventEmitter for office events
const officeEvents = new EventEmitter();

// 2. In the onEvent callback of SDK query():
onEvent: (event) => {
  if (event.type === "tool_use") {
    const toolContext = formatToolLabel(event.data.tool, event.data.input);
    officeEvents.emit("tool", { name: event.data.tool, context: toolContext });

    // Detect subagent spawn
    if (event.data.tool === "Agent") {
      const input = event.data.input as Record<string, unknown>;
      officeEvents.emit("subagent", {
        action: "spawn",
        id: String(input.task_id ?? crypto.randomUUID()),
        type: String(input.subagent_type ?? "general"),
        description: String(input.description ?? ""),
      });
    }
  }
  if (event.type === "tool_result" && event.data.tool === "Agent") {
    officeEvents.emit("subagent", {
      action: "complete",
      id: String(event.data.task_id ?? ""),
    });
  }
}

// 3. In /api/status/stream handler — subscribe to both:
activity.on("change", (data) => {
  writer.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
});
officeEvents.on("tool", (data) => {
  writer.write(`event: tool\ndata: ${JSON.stringify(data)}\n\n`);
});
officeEvents.on("subagent", (data) => {
  writer.write(`event: subagent\ndata: ${JSON.stringify(data)}\n\n`);
});
```

**Note on subagent detection**: The Claude SDK's `Agent` tool uses `subagent_type` (optional), `description`, and `prompt` fields. We read `subagent_type` if present, otherwise fall back to `"general"`. The `description` field contains a short summary (e.g., "Explore codebase structure"). If the SDK event format changes, this parsing is isolated in one place.

### New Endpoints

```typescript
// Character config — stored in $MECHA_STATE_DIR/character.json
GET  /api/config/character
  Response: { skin: number, hair: number, outfit: string }
  Default (file missing): { skin: 0, hair: 0, outfit: "outfit1" }

POST /api/config/character
  Body: { skin: number, hair: number, outfit: string }
  Validates: skin 0-2, hair 0-7, outfit matches /^(outfit[1-6]|suit[1-4])$/
  Writes to: $MECHA_STATE_DIR/character.json
  Response: { ok: true }
```

### No changes to `/api/status` snapshot

The `/api/status` GET endpoint remains unchanged. The Office tab gets all real-time data from SSE + polling individual endpoints. No need to bloat the status snapshot.

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
│   │       ├── office-view.tsx       # React wrapper: lazy-loads Phaser, overlays, status bar
│   │       ├── office-bridge.ts      # OfficeBridge type + singleton factory
│   │       ├── office-status.ts      # SSE subscription + polling → writes bridge
│   │       ├── office-scene.ts       # Phaser Scene: preload, create, update
│   │       ├── character.ts          # Character: compositing, animation state machine
│   │       ├── pathfinding.ts        # A* on walkable tile grid
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
├── server.ts                     # Add officeEvents emitter, enhanced SSE, character endpoints
└── character-config.ts           # Read/write $MECHA_STATE_DIR/character.json
```

## Office Layout

Small office, ~16×14 tiles at 32×32px = 512×448px canvas.

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

The desk is central — the character's "home" position. All other zones are reachable within 4-8 tiles of walking.

## Character System

### Sprite Compositing

Four layers rendered in order (bottom to top):

1. **Shadow** — `metrocity/CharacterModel/Shadow.png` (32×32 static, rendered at character feet)
2. **Body** — `metrocity/CharacterModel/Character Model.png` (768×192 sheet)
   - 24 columns × 6 rows of 32×32 frames
   - Each row is one skin-tone variant (rows 0-5 provide 3 skin tones × 2 rows each)
   - Within each pair of rows: row 0 is used for the walk cycle, row 1 may be idle/alternate poses
   - **Implementation note**: The exact row-pair meaning must be verified against the actual sprite sheet during implementation. If both rows in a pair are identical walk frames, use row 0 only. If they differ, row 1 provides alternate poses for sub-animations.
   - Columns: 4 directions × 6 frames = 24. Direction order: down (0-5), left (6-11), right (12-17), up (18-23)
3. **Hair** — `metrocity/Hair/Hairs.png` (768×256, 24 cols × 8 rows)
   - 8 hair styles, same column layout as body
4. **Outfit** — `metrocity/Outfits/Outfit{1-6}.png` (768×32 each, 24 cols × 1 row)
   - OR `metrocity-2.0/Suit.png` (768×128, 24 cols × 4 rows) for suit variants

All layers share the same 32×32 grid and 24-column layout. Phaser renders them as stacked sprites with matching frame indices.

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

**Walking**: Uses the 6-frame walk cycle from the sprite sheet. Direction set by pathfinding vector. Speed: 2 tiles/second (~64px/s).

**Idle sub-animations at zone**: The character's idle pose changes based on `currentTool`:

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

**Implementation note**: Sub-animations are composed from:
- 2-3 frames of the existing walk cycle (character facing direction of furniture)
- Small overlay sprites (thought bubble, paper, phone, speech bubble, `Zzz`, sparks)
- Monitor screen tint changes (green for terminal, blue for web, white for default)

No new character sprite sheets are needed. Overlay sprites are small PNGs (~16×16 to 32×32) created as part of this feature.

### Character Editor

React modal accessible from clicking the character sprite or a button on the Office tab.

```
┌─────────────────────────────────┐
│  Character Editor               │
│                                 │
│  ┌───────┐  Skin: [○ ○ ●]      │
│  │       │                      │
│  │ Live  │  Hair: [grid of 8]   │
│  │Preview│        ○○○○          │
│  │       │        ○○○○          │
│  │       │                      │
│  └───────┘  Outfit: [grid of 10]│
│             ○○○○○               │
│             ○○○○○               │
│                                 │
│         [Save]  [Cancel]        │
└─────────────────────────────────┘
```

- Live preview: Canvas element rendering composited character with walk animation
- On Save: `POST /api/config/character` → writes `$MECHA_STATE_DIR/character.json`
- On mount: `GET /api/config/character` → loads current config
- Preview renders at 2× or 3× scale for clarity (64×64 or 96×96)

## Subagent Clone System

When the bot spawns subagents (via the `Agent` tool), translucent clone sprites appear:

1. SSE emits `event: subagent` with `action: "spawn"` → React adds to `bridge.state.subagents[]`
2. Phaser's `SubagentCloneManager` spawns a new character sprite:
   - Same appearance as main character but at 50% alpha
   - Positioned at a relevant zone (heuristic: `code-reviewer` → desk, `Explore` → desk, `general-purpose` → desk, default → desk)
   - Small floating label above: subagent `type` text
   - If multiple clones at same zone, offset by 16px horizontally to avoid overlap
3. SSE emits `event: subagent` with `action: "complete"` → React removes from `bridge.state.subagents[]`
4. Phaser fades out the clone over 500ms and destroys the sprite

**Max clones**: 5 visible simultaneously. If more spawn, show a `+N` counter badge on the last visible clone.

**Fallback**: If SSE `subagent` events are not available (e.g., older server version), clones are simply not shown. The feature degrades gracefully.

## Ambient Environment

### Clock (wall)
- Shows real time (browser's local time)
- Phaser graphics: circle face + 2 rotating line sprites (hour hand, minute hand)
- Updates every 60 seconds in `update()` loop

### Coffee Cups (on desk side table)
- Client-side counter: increments by 1 each time `bridge.state.activity` transitions from `"idle"` to any other state
- Visual: small coffee cup sprites (16×16) placed on the side table
- Max 5 visible cups; after 5, show a stacked-cups sprite
- Resets to 0 when `bridge.state.idleSinceSec` exceeds 1800 (30 minutes)
- Counter is ephemeral (not persisted — resets on page reload)

### Plant (on shelf)
- Visual state derived from `bridge.state.consecutiveErrors`:
  - 0: healthy green plant sprite
  - 1-2: slightly drooping sprite
  - 3-4: wilted/brown sprite
  - 5+: dead plant sprite
- Recovers when `consecutiveErrors` drops (polled from `/api/schedule`)
- Uses 4 pre-made plant sprite variants (16×16 or 32×32)

### Window Light
- Tint overlay on window sprites based on browser's local hour:
  - 6-10: warm yellow tint (0xFFF8E1, alpha 0.3)
  - 10-16: no tint (bright daylight)
  - 16-19: orange tint (0xFFE0B2, alpha 0.3)
  - 19-6: dark blue tint (0x1A237E, alpha 0.5), small star sprites visible

## Furniture Click Zones

Each clickable furniture piece has a Phaser `Zone` with `setInteractive()`. On pointerdown:

| ClickableItem | Furniture Sprite | React Overlay |
|---------------|-----------------|---------------|
| `computer` | Monitor on desk | ConversationViewer for active session |
| `phone` | Wall phone | Event log filtered to `source: "interbot"` |
| `printer` | Printer + file cabinet | ScheduleView (existing component) |
| `server` | Server rack | Event log filtered to `status: "error"` |
| `door` | Door + mailbox | Event log filtered to `source: "webhook"` |
| `character` | The character sprite itself | Character editor modal |

Sofa is **not clickable** — it's a rest zone with no associated data view.

Overlays are React components rendered as absolutely-positioned panels above the Phaser canvas `<div>`. Styled with existing dashboard theme CSS variables. Dismissed by clicking outside or pressing Escape.

## Status Bar

A thin React `<div>` below the Phaser canvas:

```
[●] thinking · editing src/app.ts · 2m 34s · $0.03 today
```

Components (left to right):
- **Status dot**: colored circle (green=idle, yellow=thinking, blue=calling, purple=scheduled, orange=webhook, red=error)
- **Activity label**: `bridge.state.activity`
- **Tool context**: `bridge.state.currentTool` + `bridge.state.currentToolContext` (using existing `formatToolLabel` from `lib/format.ts`)
- **Task duration**: derived from `bridge.state.taskStartedAt` (live timer, updates every second)
- **Cost today**: `$${bridge.state.costToday.toFixed(2)} today`

When idle: `[●] idle · last active 5m ago`

## Asset Loading & Error Handling

### Preload Phase
Phaser's `preload()` loads all sprite sheets and tileset images. A loading bar is shown in the Phaser scene during load.

### Missing Assets
If any asset fails to load in Phaser's `preload()`:
- Log a warning to console
- Use a colored rectangle placeholder (Phaser `Graphics`) for missing sprites
- The scene still renders — missing textures appear as colored blocks rather than crashing
- This allows development to proceed before all custom overlay sprites (thought bubble, etc.) are created

### Phaser Load Failure
If `import("phaser")` fails (e.g., network error):
- The React wrapper shows a retry button: "Failed to load Pixel Office. [Retry]"

## Dependencies

Add to `agent/dashboard/package.json`:
```json
{
  "phaser": "^3.80.1"
}
```

No other new dependencies. Phaser is dynamically imported — not in the main bundle.

## Testing Strategy

- **Unit tests** (vitest): Pathfinding A* correctness, zone mapping (activity→zone ID), bridge state parsing, `formatToolLabel` (already tested)
- **Visual manual testing**: Phaser scene rendering, character walk cycle, furniture click zones, overlay positioning
- **Integration**: Mock SSE in dev mode (extend existing `mock-api.ts`) to emit state/tool/subagent events on a timer
- **Character editor**: Test layer compositing logic (correct frame indices for skin/hair/outfit combinations)
- **Ambient**: Manual verification of clock, coffee cups, plant states, window tint

## Out of Scope (v1)

- Multi-bot shared office (v2 — add more characters to same scene)
- Sound effects
- Mobile/touch optimization
- Office layout editor (use hand-authored tilemap data)
- Saving/loading office furniture arrangement
- Chat bubbles with actual message text (status indicators only)
- Custom overlay sprites for every tool (v1 uses monitor tint changes + generic overlays)
