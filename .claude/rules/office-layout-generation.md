# Office Layout Generation Rules

Rules for programmatically generating pixel office layouts. These apply when writing layout generator scripts or modifying `default-layout.json`.

## Grid Structure

### VOID Padding
- Every room's top wall row needs **at least 2 VOID rows above it** for wall sprites to render (wall sprites are 32px tall on 16px tiles).
- Wall-mounted furniture on top rooms' walls needs **3 VOID rows above** — 2 for wall sprite + 1 for the furniture sprite extending above.
- Bottom rooms' walls only get 1 VOID row above (the corridor occupies the rest), so only use small wall items there.
- Right edge: 1 VOID column for clean border. Left edge: wall at col 0 (no VOID needed). Bottom edge: 1 VOID row.

### Room Anatomy (top to bottom)
```
Row N-3:  VOID  VOID  VOID  VOID  VOID  VOID     ← furniture sprite space (top rooms only)
Row N-2:  VOID  VOID  VOID  VOID  VOID  VOID     ← wall sprite extension
Row N-1:  VOID  VOID  VOID  VOID  VOID  VOID     ← wall sprite extension
Row N:    WALL  WALL  WALL  WALL  WALL  WALL      ← top wall (bitmask auto-tiles)
Row N+1:  WALL  floor floor floor floor WALL      ← first floor row
...       WALL  floor floor floor floor WALL      ← interior (usable for furniture)
Row N+H-1:WALL  floor floor floor floor WALL      ← buffer row (small items only)
Row N+H:  WALL  WALL  door  door  WALL  WALL      ← bottom wall (doorway to corridor)
```
- Side walls (col 0 and col W) enclose the room left and right.
- The divider wall between left/right rooms (e.g., col 10) is solid — no doorways when a corridor exists.

### Bottom Wall Buffer Zone
Wall sprites are 32px tall and extend 1 tile upward. The **last interior row** before a bottom wall is partially occluded. Rules:
- **No tall furniture** in the last row before a bottom wall.
- Small floor items (BIN, POT) are OK — they're short enough.
- Characters walking through the buffer row is fine.
- Usable furniture rows: `top_wall + 1` to `bottom_wall - 2`.

### Vertically Stacked Rooms with Corridor
Between two rows of rooms, insert a walkable corridor:
```
Row A:    WALL  WALL  door  door  WALL  WALL      ← bottom wall of top rooms (doorways)
Row A+1:  hall  hall  hall  hall  hall  hall       ← corridor floor (open sides, floor tiles)
Row A+2:  hall  hall  hall  hall  hall  hall       ← corridor floor
Row A+3:  hall  hall  hall  hall  hall  hall       ← corridor floor (extends to bottom doorstep)
Row A+4:  VOID  VOID  VOID  VOID  VOID  VOID     ← wall-mount sprite space (1 row sufficient for small items)
Row A+5:  WALL  WALL  door  door  WALL  WALL      ← top wall of bottom rooms (matching doorways)
Row A+6:  WALL  floor floor floor floor WALL      ← first floor of bottom room
```
- Corridor is 3-4 tiles tall (rows A+1 through A+3 or A+4).
- **Corridor sides are floor tiles** (not WALL, not VOID) — open passageway.
- Doorways in the bottom wall of top rooms must **align with** doorways in the top wall of bottom rooms.
- The corridor spans the full width (cols 0 through W-1), connecting all rooms.
- Only **1 VOID row** above the bottom rooms' wall — sufficient for small wall items (BOOKSHELF 2×1, SMALL_PAINTING 1×2, HANGING_PLANT 1×2, CLOCK 1×2). No large items (DOUBLE_BOOKSHELF, WHITEBOARD, LARGE_PAINTING).

### Room Sizing
- Minimum interior: 6×6 tiles (1 desk setup + walking space).
- Recommended interior: 9×10 tiles (2-4 workstations + decoration + buffer).
- Maximum recommended: 12×12 tiles (beyond this feels empty).
- Total grid must stay within 64×64 (`MAX_COLS × MAX_ROWS`).
- Account for the 1-row buffer at the bottom wall.

## Tile Types

| Value | Name | Walkable | Renders |
|-------|------|----------|---------|
| 0 | WALL | No | Wall sprite (bitmask auto-tile) |
| 1-9 | FLOOR_1 to FLOOR_9 | Yes | Floor pattern + color |
| 255 | VOID | No | Nothing (transparent) |

- Use different FLOOR_N values per room for visual variety.
- Each tile has a `FloorColor { h, s, b, c }` for colorization. Walls use a wall color; VOID uses `null`.
- Keep wall color consistent across the entire layout.

## Doorways

- A doorway is a **floor tile replacing a wall tile** in the wall row.
- Recommended width: 3 tiles.
- Doorway tiles use the **adjacent room's floor type and color** (not corridor color).
- Top/bottom wall doorways align vertically so the corridor connects them.
- **No side-wall doorways** between left/right rooms when a corridor exists — all traffic goes through the corridor.

## Furniture Placement

### Complete Furniture Catalog

**Desks (category: desks)**
| Type | Footprint (W×H) | bgTiles | Notes |
|------|-----------------|---------|-------|
| DESK_FRONT | 3×2 | 1 | Main workstation |
| DESK_SIDE | 1×4 | 1 | Narrow workstation, 2-way rotation with DESK_FRONT |
| TABLE_FRONT | 3×4 | 1 | Conference table |
| COFFEE_TABLE | 2×2 | 0 | Lounge centerpiece |
| SMALL_TABLE_FRONT | 2×2 | 1 | Small work surface |
| SMALL_TABLE_SIDE | 1×3 | 1 | Narrow side table, 2-way rotation with SMALL_TABLE_FRONT |

**Chairs (category: chairs) — each footprint tile generates 1 seat**
| Type | Footprint | bgTiles | Facing | Notes |
|------|-----------|---------|--------|-------|
| CUSHIONED_BENCH | 1×1 | 0 | auto (desk adjacency) | Simple seat |
| CUSHIONED_CHAIR_FRONT | 1×1 | 0 | DOWN | Armchair |
| CUSHIONED_CHAIR_BACK | 1×1 | 0 | UP | Armchair |
| CUSHIONED_CHAIR_SIDE | 1×1 | 0 | RIGHT | Armchair (`:left` variant faces LEFT) |
| WOODEN_CHAIR_FRONT | 1×2 | 1 | DOWN | Tall chair |
| WOODEN_CHAIR_BACK | 1×2 | 1 | UP | Tall chair |
| WOODEN_CHAIR_SIDE | 1×2 | 1 | RIGHT | Tall chair (`:left` variant faces LEFT) |
| WOODEN_BENCH | 1×1 | 0 | auto | Simple bench |
| SOFA_FRONT | 2×1 | 0 | DOWN | 2-seat couch |
| SOFA_BACK | 2×1 | 0 | UP | 2-seat couch |
| SOFA_SIDE | 1×2 | 0 | RIGHT | 2-seat couch (`:left` variant faces LEFT) |

**Wall-mounted (canPlaceOnWalls: true)**
| Type | Footprint | Size class | Notes |
|------|-----------|------------|-------|
| BOOKSHELF | 2×1 | small | Sits entirely on wall row |
| DOUBLE_BOOKSHELF | 2×2 | **large** | Extends 1 row above wall |
| CLOCK | 1×2 | small | Extends 1 row above wall |
| WHITEBOARD | 2×2 | **large** | Extends 1 row above wall |
| LARGE_PAINTING | 2×2 | **large** | Extends 1 row above wall |
| SMALL_PAINTING | 1×2 | small | Extends 1 row above wall |
| SMALL_PAINTING_2 | 1×2 | small | Extends 1 row above wall |
| HANGING_PLANT | 1×2 | small | Also surface-placeable |

**Surface items (canPlaceOnSurfaces: true) — placed ON desks**
| Type | Footprint | Notes |
|------|-----------|-------|
| PC_FRONT_OFF | 1×2 | bgTiles=1. Screen faces DOWN |
| PC_BACK | 1×2 | bgTiles=1. Screen faces UP |
| PC_SIDE | 1×2 | bgTiles=1. Screen faces LEFT |
| PC_SIDE:left | 1×2 | bgTiles=1. Screen faces RIGHT |
| COFFEE | 1×1 | Place on any desk/table |
| HANGING_PLANT | 1×2 | Can also go on walls |

**Floor decorations**
| Type | Footprint | bgTiles | Notes |
|------|-----------|---------|-------|
| PLANT | 1×2 | 1 | Characters walk behind top row |
| PLANT_2 | 1×2 | 1 | Variant |
| LARGE_PLANT | 2×3 | 0 | Large, fully blocks tiles |
| CACTUS | 1×2 | 1 | Characters walk behind top row |
| BIN | 1×1 | 0 | Small |
| POT | 1×1 | 0 | Small |

### Placement Rules

1. **Wall-mounted items**: the **bottom row** of the footprint must sit on a WALL tile. The `row` property in JSON is the top-left corner, so for a 2×2 item on wall row W, set `row = W - 1`. For a 2×1 item, set `row = W` (single row, sits directly on wall).
2. **Surface items**: placed on desk tiles. Cannot stack on other surface items.
3. **backgroundTiles**: top N rows of the footprint are walkable (characters walk behind/through).
4. **No overlap**: non-background footprint tiles cannot overlap other furniture (except surface-on-desk).
5. **Floor items**: all non-background footprint tiles must be on floor tiles (not WALL or VOID).
6. **No furniture on doorways**: wall-mounted items must not overlap doorway columns. Account for multi-tile width (e.g., BOOKSHELF 2×1 at col 13 occupies cols 13-14 — if door is at cols 14-16, col 14 overlaps).
7. **Wall art size by room position**:
   - **Top rooms** (2-3 VOID rows above wall): any size — WHITEBOARD, DOUBLE_BOOKSHELF, LARGE_PAINTING, etc.
   - **Bottom rooms** (1 VOID row above wall, corridor above that): **small items only** — BOOKSHELF, SMALL_PAINTING, SMALL_PAINTING_2, HANGING_PLANT, CLOCK.
8. **Chairs face their desk/table**: chair orientation points TOWARD the adjacent work surface.
9. **No side-wall doorways when corridor exists**: all traffic goes through the corridor.

### PC Orientation

This is the most error-prone rule. The PC sprite orientation determines which SIDE of the PC you see, not which direction the screen faces.

| PC Type | You see | Screen faces |
|---------|---------|-------------|
| `PC_FRONT_OFF` / `PC_FRONT_ON_*` | the screen | DOWN |
| `PC_BACK` | the back | UP |
| `PC_SIDE` | the right side | **LEFT** |
| `PC_SIDE:left` | the left side | **RIGHT** |

**To point the screen at a chair, use the SAME variant name as the chair:**

| Chair variant | Chair faces | PC variant to use | Screen faces |
|---------------|-------------|-------------------|-------------|
| `_SIDE` (or BENCH below desk) | RIGHT (or UP) | `PC_SIDE` | LEFT (toward chair) |
| `_SIDE:left` | LEFT | `PC_SIDE:left` | RIGHT (toward chair) |
| `_FRONT` (or BENCH below desk) | DOWN (or UP) | `PC_FRONT_OFF` | DOWN (toward chair below) |
| `_BACK` | UP | `PC_BACK` | UP (toward chair above) |

**Mnemonic:** Chair and PC share the same `_SIDE` / `_SIDE:left` / `_FRONT` / `_BACK` suffix.

### Furniture Group Templates

Place furniture as pre-validated groups, not individual pieces. Each template uses an anchor point (C, R).

#### Front Workstation (1 seat)
Desk with PC on top, chair below facing up.
```
DESK_FRONT(C, R)              ← 3×2, bgTiles=1 (row R is walkable)
PC_FRONT_OFF(C+1, R)          ← on desk, screen DOWN toward chair
CUSHIONED_BENCH(C+1, R+2)     ← auto-faces UP toward desk
```
Footprint: 3w × 3h. Seats: 1.

#### Side Desk — chair LEFT (1 seat)
```
DESK_SIDE(C, R)               ← 1×4, bgTiles=1
PC_SIDE(C, R+1)               ← on desk, screen LEFT toward chair
WOODEN_CHAIR_SIDE(C-1, R+1)   ← faces RIGHT toward desk
```
Footprint: 2w × 4h. Seats: 1.

#### Side Desk — chair RIGHT (1 seat)
```
DESK_SIDE(C, R)               ← 1×4
PC_SIDE:left(C, R+1)          ← on desk, screen RIGHT toward chair
WOODEN_CHAIR_SIDE:left(C+1, R+1) ← faces LEFT toward desk
```
Footprint: 2w × 4h. Seats: 1.

#### Meeting Table (4 seats, 4 PCs)
TABLE_FRONT is 3×4, bgTiles=1. Chairs and PCs on both sides.
```
TABLE_FRONT(C, R)                              ← 3×4
Left side:
  WOODEN_CHAIR_SIDE(C-1, R+1)                  ← faces RIGHT
  WOODEN_CHAIR_SIDE(C-1, R+3)
  PC_SIDE(C, R+1)                              ← screen LEFT toward chair
  PC_SIDE(C, R+3)
Right side:
  WOODEN_CHAIR_SIDE:left(C+3, R+1)             ← faces LEFT
  WOODEN_CHAIR_SIDE:left(C+3, R+3)
  PC_SIDE:left(C+2, R+1)                       ← screen RIGHT toward chair
  PC_SIDE:left(C+2, R+3)
```
Footprint: 5w × 4h. Seats: 4.

#### Lounge (8 seats)
COFFEE_TABLE is 2×2. Sofas surround it on all 4 sides.
```
SOFA_FRONT(C, R-1)            ← faces DOWN toward table
SOFA_SIDE(C-1, R)             ← faces RIGHT toward table
COFFEE_TABLE(C, R)             ← 2×2
COFFEE(C, R+1)                 ← on table
SOFA_SIDE:left(C+2, R)        ← faces LEFT toward table
SOFA_BACK(C, R+2)             ← faces UP toward table
```
Footprint: 4w × 4h. Seats: 8.

#### Reading Nook — top/bottom chairs (4 seats)
SMALL_TABLE_FRONT is 2×2, bgTiles=1.
```
CUSHIONED_CHAIR_FRONT(C, R-1)     ← faces DOWN
CUSHIONED_CHAIR_FRONT(C+1, R-1)   ← faces DOWN
SMALL_TABLE_FRONT(C, R)           ← 2×2
CUSHIONED_CHAIR_BACK(C, R+2)      ← faces UP
CUSHIONED_CHAIR_BACK(C+1, R+2)    ← faces UP
```
Footprint: 2w × 4h. Seats: 4.

#### Reading Nook — 4-side chairs (4 seats)
```
CUSHIONED_CHAIR_FRONT(C, R-1)         ← top, faces DOWN
CUSHIONED_CHAIR_SIDE(C-1, R)          ← left, faces RIGHT
SMALL_TABLE_FRONT(C, R)               ← 2×2
CUSHIONED_CHAIR_SIDE:left(C+2, R)     ← right, faces LEFT
CUSHIONED_CHAIR_BACK(C, R+2)          ← bottom, faces UP
```
Footprint: 4w × 4h. Seats: 4.

### Room Filling Algorithm

1. **Place wall art** — on the top wall row, avoiding doorway columns. Large items for top rooms, small items for bottom rooms.
2. **Place primary furniture groups** — select 1-2 templates for the room type. Leave at least 1-tile walkway between groups and from side walls.
3. **Place decorations** — fill corners/edges with plants, pots, bins. Plants with bgTiles go against walls. Small items (POT, BIN) go in corners or buffer rows.
4. **Verify pathfinding** — BFS from every seat to every doorway. No isolated seats.

### Room Type Presets

| Room Type | Primary Groups | Wall Art | Decor |
|-----------|---------------|----------|-------|
| Office | 1-2 Front Workstations + 1 Meeting Table | Bookshelves, Clock, Whiteboard | Bins, small plants |
| Lounge | 1 Lounge + side reading corner | Paintings | Plants, coffee, pot |
| Lab | 2 Front Workstations + 1 Side Desk | Whiteboard, Bookshelf | Cactus, plants |
| Library | 1 Reading Nook | Many bookshelves | Large plant, pots |

## Pathfinding Connectivity

- **Every floor tile must be reachable** from every other floor tile via 4-connected BFS (no diagonals).
- Doorways connect rooms through the corridor — verify no isolated rooms.
- Leave at least 1-tile-wide walkway between furniture clusters.
- Seat tiles are automatically excluded from blocked tiles (characters can path to seats).

## Color Guidelines

- Each room should have a distinct floor color for visual identity.
- Wall color: consistent across the entire layout.
- Recommended wall color: `{h: 214, s: 30, b: -100, c: -55}`
- Floor color presets:
  - Brown/warm: `{h: 25, s: 48, b: -43, c: -88}` (office)
  - Blue/cool: `{h: 209, s: 39, b: -25, c: -80}` (lounge)
  - Green: `{h: 140, s: 35, b: -30, c: -70}` (lab)
  - Purple: `{h: 270, s: 30, b: -20, c: -75}` (library)
  - Warm gray: `{h: 30, s: 15, b: -10, c: -50}` (corridor)

## Layout JSON Structure

```json
{
  "version": 1,
  "cols": N,
  "rows": M,
  "layoutRevision": 2,
  "tiles": [/* flat array, length = cols × rows */],
  "tileColors": [/* parallel array, FloorColor | null */],
  "furniture": [
    { "uid": "f-...", "type": "DESK_FRONT", "col": 5, "row": 12 }
  ]
}
```

- `tiles[r * cols + c]` = tile type at (col, row).
- `tileColors[r * cols + c]` = FloorColor for that tile (`null` for walls/void).
- `furniture[].col` and `.row` = **top-left corner** of the footprint.
- `layoutRevision: 2` = post-migration layout (prevents legacy VOID rewrite).
- UIDs: `f-{timestamp}-{random4}` (editor) or `f-{room}-{type}` (generator).
