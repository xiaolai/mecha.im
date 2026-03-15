# Avatar Editor — Design Spec

**Date**: 2026-03-15
**Status**: Draft

## Overview

Per-bot avatar customization for the pixel office. Users can choose a character skin (palette), apply a color tint (hue shift), and set a display name. Configuration is persisted in a dedicated JSON file and served via a new API endpoint. The avatar editor appears in two places: a full editor in the bot Settings view (fleet mode only), and a click popover in the Office view that links to it.

## Data Model

### Storage

File: `<mechaDir>/office-avatars.json`

```json
{
  "posca": {
    "palette": 2,
    "hueShift": 45,
    "displayName": "Posca"
  },
  "scout": {
    "palette": 0,
    "hueShift": 0,
    "displayName": "Scout Bot"
  }
}
```

Shape per entry:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `palette` | `number` (0-5) | auto-assigned | Character skin index |
| `hueShift` | `number` (0-359) | 0 | Hue rotation in degrees |
| `displayName` | `string` | bot name | Name shown in office overlays |

- Keyed by bot name (matches `docker.list()` name and bot config name).
- Missing entry = bot uses auto-assigned palette via `pickDiversePalette()` (current behavior, backward compatible).
- GET serves raw file content; clients should clamp out-of-range values.

### API

#### `GET /api/office/avatars`

Returns the full avatars map. Returns `{}` if file doesn't exist.

**Response**: `200 OK` with JSON body (the full map).

#### `POST /api/office/avatars`

Writes a single bot's avatar config. Reads existing file, merges the update, writes back atomically.

**Request body**:
```json
{
  "name": "posca",
  "palette": 2,
  "hueShift": 45,
  "displayName": "Posca"
}
```

**Validation**:
- `name`: required, must pass `isValidName()`
- `palette`: required, integer 0-5
- `hueShift`: required, integer 0-359
- `displayName`: required, string, 1-32 characters, trimmed, control characters (U+0000-U+001F) stripped

**Response**: `200 OK` with `{ "status": "saved" }`.

Both endpoints require dashboard auth (existing `/api/*` middleware).

**Concurrency note**: The read-merge-write cycle is not fully serialized, but race risk is negligible since concurrent edits target different bot keys. Add file locking or ETag if needed later.

## UI: Settings View — Avatar Section

Location: top of `views/settings.tsx`, above the existing Costs section. **Only shown in fleet mode** (`isFleet === true` from `useFleet()`), since the avatar API is a fleet-level endpoint.

### Fetch Routing

The avatar endpoints (`/api/office/avatars`) are fleet-level. Use `fleetFetch` (not `botFetch`) and read the current bot name from `useFleet().selectedBot`.

### Layout (Compact Card)

```
┌──────────────────────────────────────────────────┐
│  ┌────────┐  Name   [  Posca               ]    │
│  │        │  Skin   [■][■][■][■][■][■]          │
│  │ sprite │  Tint   ═══════●═══════════════     │
│  │preview │                                      │
│  └────────┘                                      │
└──────────────────────────────────────────────────┘
```

### Behavior

- **Character preview**: Renders the actual character sprite at the selected palette + hueShift using a small `<canvas>`. Shows the typing pose facing down (frame 0 of `typing[Direction.DOWN]`).
- **Name input**: Text field, max 32 chars. Updates `displayName`.
- **Palette swatches**: 6 clickable squares representing each skin. Selected skin has an accent border. Click to switch.
- **Hue shift slider**: Range input 0-359. Shows a rainbow gradient track. Only visible/active when palette is selected (hueShift of 0 means no tint).
- **Live preview**: Canvas re-renders immediately on any change.
- **Auto-save**: Changes are debounced (500ms) and saved via `POST /api/office/avatars`. No explicit save button needed.
- **Initial load**: On mount, fetch `GET /api/office/avatars`, find entry for current bot. If missing, show auto-assigned values as defaults.
- **Bot state**: Avatar section is available regardless of bot running state, since the data is fleet-level.

### Sprite Rendering in Preview

Use `getCharacterSprites(palette, hueShift)` from `spriteData.ts` to get the sprite data, then render frame 0 of `typing[Direction.DOWN]` onto a `<canvas>` element scaled up (e.g., 4x) with `image-rendering: pixelated`.

## UI: Office View — Click Popover

### Current Behavior (replaced)

Clicking a character immediately navigates to that bot's Sessions tab via `onSelectBot(name)`.

### New Behavior

Clicking a character shows a popover above it with:

```
┌─────────────────────┐
│      posca          │
│ [Sessions] [Avatar] │
└─────────────────────┘
```

- **Display name** (or bot name if no custom name) shown as label.
- **"Sessions" button**: Navigates to bot Sessions tab (existing behavior).
- **"Avatar" button**: Navigates to bot Settings tab.
- **Dismiss**: Click empty space, click another character, or press Escape.
- **Styling**: Pixel-art themed (matches existing office UI — `var(--pixel-bg)`, `var(--pixel-border)`, etc.).

### Implementation

- Add a `clickedAgentId` state to `PixelOffice`.
- On character click: set `clickedAgentId` instead of immediately calling `onSelectBot`.
- Render a positioned `<div>` popover using the character's screen position (from `officeState` coordinates + zoom/pan).
- "Sessions" button calls existing `onSelectBot(name)` + clears popover.
- "Avatar" button calls a new `onEditAvatar(name)` callback + clears popover.

## SSE Stream Integration

### Server Changes (`dashboard-server.ts`)

In the `/api/office/stream` handler:

1. On snapshot creation, read `office-avatars.json` once per snapshot.
2. Include avatar fields in the snapshot bot entries:

```json
{
  "bot_id": "70a6b4cfc40f",
  "name": "posca",
  "status": "idle",
  "palette": 2,
  "hueShift": 45,
  "displayName": "Posca"
}
```

3. Bots without avatar entries omit these fields (client falls back to auto-assignment).
4. Include avatar fields in `bot_join` delta events too, so bots joining after the initial snapshot get their configured appearance.

### Client Changes (`useOfficeStream.ts`)

In the snapshot handler, when calling `os.addAgent()`:

- If the bot has `palette`/`hueShift` in the snapshot, pass them as `preferredPalette` and `preferredHueShift`.
- Store `displayName` in a ref map (`botDisplayNames`) for use by the office popover and tool overlay.
- Export `getDisplayName(numericId)` alongside existing `getBotNameByNumericId()`.
- In the `bot_join` handler, also read `palette`/`hueShift` if present and pass to `addAgent()`.

## File Changes

| File | Type | Description |
|------|------|-------------|
| `src/dashboard-server.ts` | Modify | Add `GET/POST /api/office/avatars` endpoints; include avatar in SSE snapshot and `bot_join` events |
| `agent/dashboard/src/views/settings.tsx` | Modify | Add Avatar compact card section at top (fleet mode only, using `fleetFetch`) |
| `agent/dashboard/src/pixel-engine/hooks/useOfficeStream.ts` | Modify | Read avatar from snapshot and bot_join, pass to addAgent, export getDisplayName |
| `agent/dashboard/src/pixel-engine/components/PixelOffice.tsx` | Modify | Add click popover state and rendering, accept onEditAvatar prop |
| `agent/dashboard/src/app.tsx` | Modify | Add `onEditAvatar` handler: `(name) => { selectBot(name); setTab("Settings"); }`, pass to PixelOffice |

No new files needed. No changes to `officeState.ts` (addAgent already accepts preferred palette/hueShift).

## Edge Cases

- **Bot renamed**: Avatar keyed by name. Old name entry becomes orphaned (harmless). User re-configures under new name.
- **File missing**: `GET` returns `{}`. `POST` creates the file.
- **Concurrent edits**: POST does read-merge-write with `atomicWriteJsonAsync`. Race window is negligible since concurrent edits target different keys.
- **6+ bots with same palette**: Allowed. Hue shift provides visual distinction.
- **Sub-agents**: Inherit parent's palette/hueShift (existing behavior, unchanged). Not configurable independently.
- **Bot stopped**: Avatar section is available regardless of bot state (fleet-level data).
- **Bot-direct mode**: Avatar section hidden (fleet-level API not available).
- **displayName sanitization**: Control characters stripped, HTML safe via React escaping.

## Out of Scope

- Custom sprite uploads (use the 6 built-in palettes only)
- Per-session avatar changes (avatar is persistent per bot)
- Animation preview in the editor (show static pose only)
- Seat assignment persistence (separate concern, partially exists)
- Double-click shortcut to Sessions (can be added later)
