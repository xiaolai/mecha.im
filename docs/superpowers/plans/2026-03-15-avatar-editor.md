# Avatar Editor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-bot avatar customization (palette, hue shift, display name) to the pixel office with persistence and a Settings-based editor.

**Architecture:** New `office-avatars.json` file with `GET/POST /api/office/avatars` endpoints on the fleet dashboard server. Avatar data flows into the SSE stream snapshot/join events. Settings view gets a compact avatar card (fleet mode only). Office view click behavior changes to show a popover with "Sessions" and "Avatar" buttons.

**Tech Stack:** TypeScript, React, Hono (server), Canvas API (sprite preview)

**Spec:** `docs/superpowers/specs/2026-03-15-avatar-editor-design.md`

---

## Chunk 1: Server API + SSE Integration

### Task 1: Avatar API Endpoints

**Files:**
- Modify: `src/dashboard-server.ts` (add endpoints after the layout endpoints, ~line 435)

- [ ] **Step 1: Add GET /api/office/avatars endpoint**

In `src/dashboard-server.ts`, after the `POST /api/office/layout` handler (around line 435), add:

```typescript
  // --- Office Avatars API ---
  app.get("/api/office/avatars", (c) => {
    const avatarsPath = join(getMechaDir(), "office-avatars.json");
    if (!existsSync(avatarsPath)) {
      return c.json({});
    }
    try {
      const content = fsReadFileSync(avatarsPath, "utf-8");
      return c.json(JSON.parse(content));
    } catch {
      return c.json({});
    }
  });
```

- [ ] **Step 2: Add POST /api/office/avatars endpoint**

Immediately after the GET handler:

```typescript
  app.post("/api/office/avatars", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);

    const name = body.name;
    if (!name || typeof name !== "string" || !isValidName(name)) {
      return c.json({ error: "Invalid bot name" }, 400);
    }

    const palette = body.palette;
    if (typeof palette !== "number" || !Number.isInteger(palette) || palette < 0 || palette > 5) {
      return c.json({ error: "palette must be integer 0-5" }, 400);
    }

    const hueShift = body.hueShift;
    if (typeof hueShift !== "number" || !Number.isInteger(hueShift) || hueShift < 0 || hueShift > 359) {
      return c.json({ error: "hueShift must be integer 0-359" }, 400);
    }

    let displayName = body.displayName;
    if (typeof displayName !== "string") {
      return c.json({ error: "displayName required" }, 400);
    }
    // Strip control characters and trim
    displayName = displayName.replace(/[\x00-\x1F]/g, "").trim();
    if (displayName.length === 0 || displayName.length > 32) {
      return c.json({ error: "displayName must be 1-32 characters" }, 400);
    }

    const avatarsPath = join(getMechaDir(), "office-avatars.json");
    let avatars: Record<string, unknown> = {};
    if (existsSync(avatarsPath)) {
      try {
        avatars = JSON.parse(fsReadFileSync(avatarsPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
    }

    avatars[name] = { palette, hueShift, displayName };
    await atomicWriteJsonAsync(avatarsPath, avatars);
    return c.json({ status: "saved" });
  });
```

- [ ] **Step 3: Verify server builds**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Test endpoints manually**

```bash
# Start dashboard
DOCKER_HOST=unix:///Users/joker/.colima/default/docker.sock MECHA_DIR=/Users/joker/mecha-camp node dist/src/cli.js dashboard &

# Test GET (empty)
curl -s http://localhost:7700/api/office/avatars
# Expected: {}

# Test POST
curl -s -X POST http://localhost:7700/api/office/avatars \
  -H "Content-Type: application/json" \
  -d '{"name":"posca","palette":2,"hueShift":45,"displayName":"Posca"}'
# Expected: {"status":"saved"}

# Test GET (after save)
curl -s http://localhost:7700/api/office/avatars
# Expected: {"posca":{"palette":2,"hueShift":45,"displayName":"Posca"}}
```

Note: Add auth cookie/token header if TOTP is enabled.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard-server.ts
git commit -m "feat(avatar): add GET/POST /api/office/avatars endpoints"
```

---

### Task 2: Include Avatar in SSE Snapshot + bot_join

**Files:**
- Modify: `src/dashboard-server.ts` (SSE stream handler, ~line 437-475)

- [ ] **Step 1: Read avatars file in sendSnapshot and include in snapshot entries**

In the `sendSnapshot()` function inside the `/api/office/stream` handler, read the avatars file and merge avatar data into each bot entry:

```typescript
      async function sendSnapshot() {
        const bots = await docker.list();
        const running = bots.filter(b => b.status === "running");

        // Read avatar config
        const avatarsPath = join(getMechaDir(), "office-avatars.json");
        let avatars: Record<string, { palette?: number; hueShift?: number; displayName?: string }> = {};
        if (existsSync(avatarsPath)) {
          try {
            avatars = JSON.parse(fsReadFileSync(avatarsPath, "utf-8"));
          } catch { /* ignore */ }
        }

        const snapshot = running.map(b => {
          const avatar = avatars[b.name];
          return {
            bot_id: b.containerId,
            name: b.name,
            status: "idle" as const,
            ...(avatar ? { palette: avatar.palette, hueShift: avatar.hueShift, displayName: avatar.displayName } : {}),
          };
        });
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ seq: seq++, bots: snapshot }) });
        knownBots.clear();
        for (const b of running) knownBots.set(b.containerId, b.name);
      }
```

- [ ] **Step 2: Include avatar data in bot_join delta events**

In the polling interval's `bot_join` branch, read avatar data for the joining bot:

```typescript
          for (const [id, name] of running) {
            if (!knownBots.has(id)) {
              knownBots.set(id, name);
              // Read avatar for joining bot
              const avatarsPath = join(getMechaDir(), "office-avatars.json");
              let avatar: { palette?: number; hueShift?: number; displayName?: string } | undefined;
              try {
                if (existsSync(avatarsPath)) {
                  const all = JSON.parse(fsReadFileSync(avatarsPath, "utf-8")) as Record<string, typeof avatar>;
                  avatar = all[name];
                }
              } catch { /* ignore */ }
              await stream.writeSSE({ event: "state", data: JSON.stringify({
                seq: seq++, type: "bot_join", bot_id: id, name,
                ...(avatar ? { palette: avatar.palette, hueShift: avatar.hueShift, displayName: avatar.displayName } : {}),
              }) });
            }
          }
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard-server.ts
git commit -m "feat(avatar): include avatar data in SSE snapshot and bot_join events"
```

---

## Chunk 2: Client SSE + Office Popover

### Task 3: Read Avatar from SSE Stream

**Files:**
- Modify: `agent/dashboard/src/pixel-engine/hooks/useOfficeStream.ts`

- [ ] **Step 1: Extend SnapshotBot and DeltaStateEvent types**

At the top of the file, update the interfaces:

```typescript
interface SnapshotBot {
  bot_id: string;
  name: string;
  status: 'idle' | 'active' | 'waiting' | 'permission';
  tool?: string;
  palette?: number;
  hueShift?: number;
  displayName?: string;
}

interface DeltaStateEvent {
  seq: number;
  type: 'bot_join' | 'bot_leave' | 'status';
  bot_id: string;
  name?: string;
  status?: string;
  palette?: number;
  hueShift?: number;
  displayName?: string;
}
```

- [ ] **Step 2: Add displayName tracking ref and getter**

After the existing refs (around line 64-69), add:

```typescript
  const displayNameMapRef = useRef(new Map<number, string>()); // numericId → displayName
```

Add the getter alongside `getBotNameByNumericId`:

```typescript
  const getDisplayName = useCallback((id: number): string | null => {
    return displayNameMapRef.current.get(id) ?? null;
  }, []);
```

- [ ] **Step 3: Use avatar data in snapshot handler**

In the snapshot `for (const bot of data.bots)` loop, change the `addAgent` call (line ~119):

```typescript
            if (!os.characters.has(numId)) {
              os.addAgent(numId, bot.palette, bot.hueShift, undefined, true);
            }
            // Store display name
            if (bot.displayName) {
              displayNameMapRef.current.set(numId, bot.displayName);
            }
```

- [ ] **Step 4: Use avatar data in bot_join handler**

In the `bot_join` branch (line ~165-167), update:

```typescript
          if (data.type === 'bot_join') {
            const numId = getNumericId(data.bot_id, data.name ?? data.bot_id);
            os.addAgent(numId, data.palette, data.hueShift);
            if (data.displayName) {
              displayNameMapRef.current.set(numId, data.displayName);
            }
```

- [ ] **Step 5: Clean up displayNameMap on bot_leave and snapshot reconciliation**

In the `bot_leave` handler, after `os.removeAgent(entry.numericId)`, add:

```typescript
              displayNameMapRef.current.delete(entry.numericId);
```

In the snapshot reconciliation loop ("Remove characters not in snapshot"), add cleanup:

```typescript
          for (const [numId, botId] of reverseMapRef.current) {
            if (!incomingIds.has(botId) && os.characters.has(numId)) {
              os.removeAgent(numId);
              displayNameMapRef.current.delete(numId);
            }
          }
```

- [ ] **Step 6: Update return value to include getDisplayName**

Change the return statement:

```typescript
  return { getBotNameByNumericId, getDisplayName };
```

- [ ] **Step 7: Build and verify**

Run: `cd agent/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add agent/dashboard/src/pixel-engine/hooks/useOfficeStream.ts
git commit -m "feat(avatar): read avatar data from SSE stream, export getDisplayName"
```

---

### Task 4: Office Click Popover

**Files:**
- Modify: `agent/dashboard/src/pixel-engine/components/PixelOffice.tsx`
- Modify: `agent/dashboard/src/app.tsx`

- [ ] **Step 1: Add onEditAvatar prop to PixelOffice**

Update the `PixelOfficeProps` interface:

```typescript
interface PixelOfficeProps {
  isActive: boolean;
  onSelectBot?: (name: string) => void;
  onEditAvatar?: (name: string) => void;
}

export function PixelOffice({ isActive, onSelectBot, onEditAvatar }: PixelOfficeProps) {
```

- [ ] **Step 2: Destructure getDisplayName from useOfficeStream**

Update the hook call:

```typescript
  const { getBotNameByNumericId, getDisplayName } = useOfficeStream(
    officeReady ? officeStateRef.current : null,
    assetsReady,
  );
```

- [ ] **Step 3: Add TILE_SIZE import and clickedAgent state, replace direct navigation**

Add import at top of file (alongside existing imports from `../constants`):

```typescript
import { TILE_SIZE } from '../constants';
```

Add state after existing state declarations:

```typescript
  const [clickedAgent, setClickedAgent] = useState<{ id: number; name: string } | null>(null);
```

Replace the existing `handleClick` callback:

```typescript
  const handleClick = useCallback(
    (agentId: number) => {
      // Check for sub-agent — focus parent's terminal
      const os = officeStateRef.current;
      if (os) {
        const meta = os.subagentMeta.get(agentId);
        if (meta) {
          const parentName = getBotNameByNumericId(meta.parentAgentId);
          if (parentName && onSelectBot) onSelectBot(parentName);
          return;
        }
      }
      const name = getBotNameByNumericId(agentId);
      if (name) {
        // Show popover instead of direct navigation
        setClickedAgent((prev) => (prev?.id === agentId ? null : { id: agentId, name }));
      }
    },
    [getBotNameByNumericId, onSelectBot],
  );
```

- [ ] **Step 4: Add popover dismiss handler**

```typescript
  // Dismiss popover on Escape, zoom/pan change, or click on canvas (empty space)
  useEffect(() => {
    if (!clickedAgent) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClickedAgent(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clickedAgent]);

  // Dismiss popover on zoom change
  const prevZoomRef = useRef(editor.zoom);
  useEffect(() => {
    if (prevZoomRef.current !== editor.zoom) {
      setClickedAgent(null);
      prevZoomRef.current = editor.zoom;
    }
  }, [editor.zoom]);
```

- [ ] **Step 5: Render the popover in the JSX**

Add this after the `<OfficeCanvas>` component and before `{!isDebugMode && <ZoomControls ...>}`:

```tsx
      {/* Character click popover */}
      {clickedAgent && officeState && (() => {
        const ch = officeState.characters.get(clickedAgent.id);
        if (!ch) return null;
        const displayName = getDisplayName(clickedAgent.id) ?? clickedAgent.name;
        // Convert world coords to screen position (matches ToolOverlay pattern)
        const container = containerRef.current;
        if (!container) return null;
        const canvas = container.querySelector('canvas');
        if (!canvas) return null;
        const dpr = window.devicePixelRatio || 1;
        const canvasW = canvas.width; // already in device pixels
        const canvasH = canvas.height;
        const layout = officeState.getLayout();
        const mapW = layout.cols * TILE_SIZE * editor.zoom;
        const mapH = layout.rows * TILE_SIZE * editor.zoom;
        const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(editor.panRef.current.x);
        const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(editor.panRef.current.y);
        // Position above character head (sprite is 16x32, anchored bottom-center)
        const POPOVER_Y_OFFSET = -32; // above the 32px tall sprite
        const screenX = (deviceOffsetX + ch.x * editor.zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + POPOVER_Y_OFFSET) * editor.zoom) / dpr;

        return (
          <div
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translate(-50%, -100%)',
              zIndex: 60,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              padding: '6px 10px',
              boxShadow: 'var(--pixel-shadow)',
              whiteSpace: 'nowrap',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ color: '#fff', fontSize: '20px', textAlign: 'center', marginBottom: 4 }}>
              {displayName}
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <button
                style={{
                  background: 'var(--pixel-btn-bg)',
                  color: 'var(--pixel-text-dim)',
                  border: '2px solid transparent',
                  padding: '2px 8px',
                  fontSize: '18px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setClickedAgent(null);
                  onSelectBot?.(clickedAgent.name);
                }}
              >
                Sessions
              </button>
              <button
                style={{
                  background: 'var(--pixel-btn-bg)',
                  color: 'var(--pixel-text-dim)',
                  border: '2px solid transparent',
                  padding: '2px 8px',
                  fontSize: '18px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setClickedAgent(null);
                  onEditAvatar?.(clickedAgent.name);
                }}
              >
                Avatar
              </button>
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 6: Wire onEditAvatar in app.tsx**

In `agent/dashboard/src/app.tsx`, update the `<PixelOffice>` usage (around line 202-205):

```tsx
              <PixelOffice
                isActive={tab === "Office"}
                onSelectBot={(name) => { selectBot(name); setTab("Sessions"); }}
                onEditAvatar={(name) => { selectBot(name); setTab("Settings"); }}
              />
```

- [ ] **Step 7: Build and verify**

Run: `cd agent/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add agent/dashboard/src/pixel-engine/components/PixelOffice.tsx agent/dashboard/src/app.tsx
git commit -m "feat(avatar): add office click popover with Sessions + Avatar buttons"
```

---

## Chunk 3: Settings View Avatar Section

### Task 5: Avatar Editor in Settings

**Files:**
- Modify: `agent/dashboard/src/views/settings.tsx`

- [ ] **Step 1: Add imports and avatar state**

Update the React import to add `useRef`:

```typescript
import { useState, useEffect, useCallback, useRef } from "react";
```

Add `Input` to the existing components import:

```typescript
import { Button, Card, Alert, Dialog, DialogFooter, Input } from "../components";
```

Add new imports:

```typescript
import { useFleet, fleetFetch } from "../lib/fleet-context";
import { getCharacterSprites } from "../pixel-engine/sprites/spriteData";
import { Direction } from "../pixel-engine/types";
```

Inside the `Settings` component, after the existing state declarations, add:

```typescript
  const { isFleet, selectedBot } = useFleet();

  // Avatar state (fleet mode only)
  const [avatarPalette, setAvatarPalette] = useState(0);
  const [avatarHueShift, setAvatarHueShift] = useState(0);
  const [avatarDisplayName, setAvatarDisplayName] = useState("");
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const avatarSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement>(null);
```

- [ ] **Step 2: Add avatar load effect**

```typescript
  // Load avatar config on mount (fleet mode only)
  useEffect(() => {
    if (!isFleet || !selectedBot) return;
    fleetFetch("/api/office/avatars")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        const entry = (data as Record<string, { palette?: number; hueShift?: number; displayName?: string }>)[selectedBot];
        if (entry) {
          setAvatarPalette(entry.palette ?? 0);
          setAvatarHueShift(entry.hueShift ?? 0);
          setAvatarDisplayName(entry.displayName ?? selectedBot);
        } else {
          setAvatarDisplayName(selectedBot);
        }
        setAvatarLoaded(true);
      })
      .catch(() => setAvatarLoaded(true));
  }, [isFleet, selectedBot]);
```

- [ ] **Step 3: Add debounced avatar save function**

```typescript
  const saveAvatar = useCallback(
    (palette: number, hueShift: number, displayName: string) => {
      if (!isFleet || !selectedBot) return;
      if (avatarSaveTimerRef.current) clearTimeout(avatarSaveTimerRef.current);
      avatarSaveTimerRef.current = setTimeout(() => {
        fleetFetch("/api/office/avatars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: selectedBot, palette, hueShift, displayName }),
        }).catch(() => {});
      }, 500);
    },
    [isFleet, selectedBot],
  );
```

- [ ] **Step 4: Add avatar canvas rendering effect**

Add the rendering effect (imports already added in Step 1):

```typescript
  // Render avatar preview
  useEffect(() => {
    const canvas = avatarCanvasRef.current;
    if (!canvas || !avatarLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sprites = getCharacterSprites(avatarPalette, avatarHueShift);
    const sprite = sprites.typing[Direction.DOWN][0];
    if (!sprite || sprite.length === 0) return;

    const rows = sprite.length;
    const cols = sprite[0].length;
    const scale = 4;
    canvas.width = cols * scale;
    canvas.height = rows * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = sprite[r][c];
        if (color === '') continue;
        ctx.fillStyle = color;
        ctx.fillRect(c * scale, r * scale, scale, scale);
      }
    }
  }, [avatarPalette, avatarHueShift, avatarLoaded]);
```

- [ ] **Step 5: Add avatar section JSX**

In the return JSX, right after `<StatusCard />` and before the Costs section, add:

```tsx
      {/* Avatar (fleet mode only) */}
      {isFleet && avatarLoaded && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Avatar</h2>
          <Card spacing={3}>
            <div className="flex items-start gap-4">
              {/* Preview */}
              <canvas
                ref={avatarCanvasRef}
                style={{ imageRendering: 'pixelated', background: 'var(--color-muted)', borderRadius: 8 }}
                className="shrink-0"
              />
              {/* Controls */}
              <div className="flex-1 space-y-3">
                {/* Display name */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Name</label>
                  <Input
                    maxLength={32}
                    value={avatarDisplayName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setAvatarDisplayName(e.target.value);
                      saveAvatar(avatarPalette, avatarHueShift, e.target.value);
                    }}
                    className="w-full"
                  />
                </div>
                {/* Palette swatches */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Skin</label>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4, 5].map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setAvatarPalette(p);
                          saveAvatar(p, avatarHueShift, avatarDisplayName);
                        }}
                        className="w-7 h-7 rounded transition-colors"
                        style={{
                          background: ['#f4c89a', '#8b6d4a', '#e8a87c', '#c67b5c', '#5c4033', '#2c1810'][p],
                          border: p === avatarPalette ? '2px solid var(--color-primary)' : '2px solid transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
                {/* Hue shift slider */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tint ({avatarHueShift}°)</label>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={avatarHueShift}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setAvatarHueShift(v);
                      saveAvatar(avatarPalette, v, avatarDisplayName);
                    }}
                    className="w-full"
                    style={{
                      accentColor: `hsl(${avatarHueShift}, 80%, 50%)`,
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}
```

- [ ] **Step 6: Clean up save timer on unmount**

Add to the component body (or extend existing cleanup):

```typescript
  useEffect(() => {
    return () => {
      if (avatarSaveTimerRef.current) clearTimeout(avatarSaveTimerRef.current);
    };
  }, []);
```

- [ ] **Step 7: Build and verify**

Run: `cd agent/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Build dashboard and test visually**

```bash
cd agent/dashboard && npm run build
cp -r dist ../../dist/agent/dashboard/
```

Restart the dashboard server, navigate to a bot's Settings tab, verify the Avatar section appears with:
- Canvas preview showing the character sprite
- Working palette swatches
- Working hue shift slider
- Display name input
- Live preview updates

- [ ] **Step 9: Commit**

```bash
git add agent/dashboard/src/views/settings.tsx
git commit -m "feat(avatar): add avatar editor section to bot Settings view"
```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Full build**

```bash
cd /Users/joker/github/xiaolai/myprojects/mecha.im
npm run build
cd agent/dashboard && npm run build && cp -r dist ../../dist/agent/dashboard/
```

- [ ] **Step 2: Restart and test full flow**

```bash
kill $(lsof -t -i :7700) 2>/dev/null
sleep 1
DOCKER_HOST=unix:///Users/joker/.colima/default/docker.sock \
  MECHA_DIR=/Users/joker/mecha-camp \
  node dist/src/cli.js dashboard
```

Verify:
1. Fleet view shows bot(s)
2. Office tab shows characters with default palettes
3. Click character → popover with name, Sessions, Avatar buttons
4. "Sessions" → navigates to bot Sessions tab
5. "Avatar" → navigates to bot Settings tab with Avatar section visible
6. Change palette → preview updates, auto-saves
7. Change hue shift → preview updates, auto-saves
8. Change display name → auto-saves
9. Refresh page → Office shows character with saved palette/hueShift
10. Office popover shows saved display name

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "feat(avatar): end-to-end avatar editor complete"
```
