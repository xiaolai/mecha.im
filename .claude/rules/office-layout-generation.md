# Office Layout Generation Rules

Rules for programmatically generating pixel office layouts. These apply when writing layout generator scripts or modifying `default-layout.json`.

## Grid Structure

### VOID Padding
- Every room's top wall row needs **at least 2 VOID rows above it** for wall sprites to render (wall sprites are 32px tall on 16px tiles).
- Wall-mounted furniture (bookshelves, paintings, whiteboards) needs **3 VOID rows above the wall** — 2 for wall sprite + 1 for the furniture sprite extending above.
- Bottom and right edges need 1 VOID column/row for clean border.

### Room Anatomy (top to bottom)
```
Row N-3:  VOID  VOID  VOID  VOID  VOID     ← wall-mount sprite space
Row N-2:  VOID  VOID  VOID  VOID  VOID     ← wall sprite extension
Row N-1:  VOID  VOID  VOID  VOID  VOID     ← wall sprite extension
Row N:    WALL  WALL  WALL  WALL  WALL      ← top wall (bitmask auto-tiles)
Row N+1:  WALL  floor floor floor WALL      ← first floor row
...       WALL  floor floor floor WALL      ← interior
Row N+H:  WALL  floor floor floor WALL      ← last floor row
Row N+H+1: WALL  WALL  WALL  WALL  WALL    ← bottom wall (shared with room below, or terminal)
```

### Vertically Stacked Rooms with Corridor
Between two rooms stacked vertically, insert a walkable corridor so bots can traverse between all rooms. Structure:
```
Row A:   WALL WALL door door door WALL  ← bottom wall of top room (doorways)
Row A+1: WALL hall hall hall hall  WALL  ← corridor floor (walkable)
Row A+2: WALL hall hall hall hall  WALL  ← corridor floor (walkable)
Row A+3: VOID VOID VOID VOID VOID VOID ← wall-mount sprite space
Row A+4: VOID VOID VOID VOID VOID VOID ← wall sprite extension
Row A+5: WALL WALL door door door WALL  ← top wall of bottom room (matching doorways)
Row A+6: WALL floor floor floor fl WALL ← first floor of bottom room
```
- Corridor is 2-3 tiles tall (enough for characters to walk through)
- Corridor sides are VOID (open edges, not walled) — only the room walls above and below enclose it
- Use a neutral floor color for the corridor (e.g., warm gray)
- Doorways in the bottom wall of top rooms must align with doorways in the top wall of bottom rooms
- The corridor connects horizontally across the full width, allowing bots to walk between any two rooms
- 2 VOID rows above the bottom room's top wall provide space for wall-mounted furniture sprites

### Bottom Wall Buffer Zone
Wall sprites are 32px tall and extend 1 tile upward from the wall row. This means the **last interior row** (directly above a bottom wall) is visually occluded by the wall sprite. Rules:
- **Never place furniture in the last interior row** before a bottom wall
- The usable floor area is `wall_row_top + 1` to `wall_row_bottom - 2`
- Small floor items (BIN, POT) are fine in the buffer row since they're short enough
- Characters walking through the buffer row is fine — only tall sprites get clipped

Example: if top wall is row 3 and bottom wall is row 13:
- Usable furniture rows: 4 to 11
- Row 12: buffer zone (wall sprite covers upper portion)
- Row 13: wall

### Room Sizing
- Minimum interior: 6×6 tiles (enough for 1 desk setup + walking space)
- Recommended interior: 9×10 tiles (fits 2-4 workstations + decoration + buffer)
- Maximum recommended: 12×12 tiles per room (beyond this feels empty)
- Total grid must stay within 64×64 (MAX_COLS × MAX_ROWS)
- Account for 1-row buffer at bottom wall when planning furniture placement

## Tile Types

| Value | Name | Walkable | Renders |
|-------|------|----------|---------|
| 0 | WALL | No | Wall sprite (bitmask) |
| 1-9 | FLOOR_1-9 | Yes | Floor pattern + color |
| 255 | VOID | No | Nothing (transparent) |

- Use different FLOOR_N values per room for visual variety
- Each tile gets a `FloorColor { h, s, b, c }` for colorization
- Walls get a wall color (consistent across entire layout)
- VOID tiles get `null` color

## Doorways

- A doorway is a **floor tile replacing a wall tile** in the wall row
- Minimum doorway width: 1 tile (characters are 1 tile wide)
- Recommended doorway width: 2-3 tiles
- Doorway tile should use the floor type of one of the adjacent rooms
- Doorway color should blend with the adjacent floor color
- **Horizontal doorways** (in left-right dividing walls): replace wall tiles in the dividing column with floor tiles for 2-4 rows
- **Vertical doorways** (in top-bottom dividing walls): replace wall tiles in the dividing row with floor tiles for 2-3 columns

## Furniture Placement

### Categories and Guidelines

**Desks (category: desks)**
| Type | Footprint | backgroundTiles | Notes |
|------|-----------|-----------------|-------|
| DESK_FRONT | 3×2 | 1 | Main workstation, pair with chair behind |
| DESK_SIDE | 1×4 | 1 | Narrow workstation against wall |
| TABLE_FRONT | 3×4 | 1 | Conference table, surround with chairs |
| COFFEE_TABLE | 2×2 | 0 | Lounge centerpiece, surround with sofas |
| SMALL_TABLE_FRONT | 2×2 | 1 | Small work surface |
| SMALL_TABLE_SIDE | 1×3 | 1 | Narrow side table |

**Chairs (category: chairs) — generate seats for characters**
| Type | Footprint | backgroundTiles | Facing | Notes |
|------|-----------|-----------------|--------|-------|
| CUSHIONED_BENCH | 1×1 | 0 | auto (desk adjacency) | Simple seat |
| CUSHIONED_CHAIR_FRONT | 1×1 | 0 | DOWN | Armchair facing forward |
| CUSHIONED_CHAIR_BACK | 1×1 | 0 | UP | Armchair facing away |
| CUSHIONED_CHAIR_SIDE | 1×1 | 0 | RIGHT (mirror: LEFT) | Armchair facing side |
| WOODEN_CHAIR_FRONT | 1×2 | 1 | DOWN | Tall chair facing forward |
| WOODEN_CHAIR_BACK | 1×2 | 1 | UP | Tall chair facing away |
| WOODEN_CHAIR_SIDE | 1×2 | 1 | RIGHT (mirror: LEFT) | Tall chair facing side |
| WOODEN_BENCH | 1×1 | 0 | auto | Simple bench |
| SOFA_FRONT | 2×1 | 0 | DOWN | 2-seat couch facing forward |
| SOFA_BACK | 2×1 | 0 | UP | 2-seat couch facing away |
| SOFA_SIDE | 1×2 | 0 | RIGHT (mirror: LEFT) | 2-seat couch facing side |

**Wall-mounted (canPlaceOnWalls: true)**
| Type | Footprint | Notes |
|------|-----------|-------|
| BOOKSHELF | 2×1 | Bottom row must be on WALL tile |
| DOUBLE_BOOKSHELF | 2×2 | Bottom row on WALL, extends 1 row above wall |
| CLOCK | 1×2 | Bottom row on WALL |
| WHITEBOARD | 2×2 | Bottom row on WALL |
| LARGE_PAINTING | 2×2 | Bottom row on WALL |
| SMALL_PAINTING | 1×2 | Bottom row on WALL |
| SMALL_PAINTING_2 | 1×2 | Bottom row on WALL |
| HANGING_PLANT | 1×2 | Bottom row on WALL (also surface-placeable) |

**Surface items (canPlaceOnSurfaces: true)**
| Type | Footprint | Notes |
|------|-----------|-------|
| PC_FRONT_OFF | 1×2 | Place on DESK_FRONT, top row is background |
| PC_SIDE | 1×2 | Place on DESK_SIDE or TABLE, mirror: PC_SIDE:left |
| COFFEE | 1×1 | Place on any desk/table |
| HANGING_PLANT | 1×2 | Can also go on walls |

**Floor decorations**
| Type | Footprint | backgroundTiles | Notes |
|------|-----------|-----------------|-------|
| PLANT | 1×2 | 1 | Characters walk behind top row |
| PLANT_2 | 1×2 | 1 | Variant |
| LARGE_PLANT | 2×3 | 0 | Large, fully blocks |
| CACTUS | 1×2 | 1 | Characters walk behind top row |
| BIN | 1×1 | 0 | Small trash can |
| POT | 1×1 | 0 | Small pot |

### Placement Rules

1. **Wall-mounted items**: bottom row of footprint must be on a WALL tile. The item extends upward into VOID space above.
2. **Surface items**: can overlap desk tiles. Cannot stack on other surface items.
3. **backgroundTiles**: top N rows of the footprint are walkable — characters walk behind/through.
4. **No overlap**: non-background footprint tiles cannot overlap with other furniture (except surface-on-desk).
5. **Floor items**: all non-background footprint tiles must be on floor tiles (not WALL or VOID).
6. **No furniture on doorways**: wall-mounted items must not overlap doorway columns/rows in the wall. Account for multi-tile width (e.g., BOOKSHELF 2×1 at col 13 occupies cols 13-14).
10. **Wall art size by position**: Top rooms' walls (with 2-3 VOID rows above) can use large items (WHITEBOARD, DOUBLE_BOOKSHELF, LARGE_PAINTING — 2×2). Bottom rooms' walls (with corridor above) should only use small items (BOOKSHELF 2×1, SMALL_PAINTING 1×2, SMALL_PAINTING_2 1×2, HANGING_PLANT 1×2, CLOCK 1×2) — large sprites protrude into the corridor and look wrong.
7. **Chairs face their desk/table**: chair orientation points TOWARD the adjacent work surface.
8. **PCs face their user**: PC screen orientation is the OPPOSITE of the chair — faces toward the seated person.
9. **No inner doorways when corridor exists**: if rooms share a corridor, remove direct left-right doorways between adjacent rooms. All traffic goes through the corridor.

### Furniture Group Templates

Place furniture as pre-validated groups, not individual pieces. Each template defines relative positions from an anchor point (col C, row R). All orientations are pre-configured to be correct.

**IMPORTANT orientation rules:**
- **Chairs face TOWARD their desk/table** — the chair's facing direction points at the work surface
- **"Front" = facing DOWN** in this engine. "Back" = facing UP. "Side" = facing RIGHT. ":left" = facing LEFT.
- **PC screen direction mapping:**
  - `PC_SIDE` = you see the RIGHT side → screen faces LEFT
  - `PC_SIDE:left` = you see the LEFT side → screen faces RIGHT
  - `PC_FRONT_OFF/ON` = you see the screen → screen faces DOWN
  - `PC_BACK` = you see the back → screen faces UP
- **PC variant matches chair variant** — to face the screen toward a chair:
  - Chair `SIDE` (faces RIGHT) → use `PC_SIDE` (screen LEFT toward chair)
  - Chair `SIDE:left` (faces LEFT) → use `PC_SIDE:left` (screen RIGHT toward chair)
  - Chair faces UP (BENCH below desk) → use `PC_FRONT_OFF` (screen DOWN toward chair)
  - Chair faces DOWN → use `PC_BACK` (screen UP toward chair)

#### Template: Front Workstation (2 seats)
Anchor: desk top-left corner at (C, R)
```
Row R:   DESK_FRONT(C, R)         ← 3×2, backgroundTiles=1
         PC_BACK(C+1, R)          ← on desk, screen faces UP (toward person behind desk... no)
```

Actually, the correct understanding:
- PC_FRONT = you see the screen (monitor faces you/camera = faces DOWN)
- PC_BACK = you see the back of monitor (screen faces away = faces UP)

So for a DESK_FRONT at row R with chair BELOW at row R+2:
- Person sits at R+2 looking UP at desk
- PC screen should face DOWN toward person = **PC_FRONT_OFF**
```
Row R:   DESK_FRONT(C, R)         ← 3×2, backgroundTiles=1 (row R walkable)
         PC_FRONT_OFF(C+1, R)     ← on desk, screen faces DOWN toward chair ✓
Row R+2: CUSHIONED_BENCH(C+1, R+2) ← faces UP toward desk (auto via desk adjacency)
```
Footprint: 3 wide × 3 tall. Seats: 1.

#### Template: Side Desk Workstation
Anchor: desk at (C, R), chair to the LEFT
```
Col C:   DESK_SIDE(C, R)          ← 1×4, backgroundTiles=1
         PC_SIDE(C, R+1)          ← on desk, screen faces RIGHT (away from wall, toward room)
Col C-1: WOODEN_CHAIR_SIDE:left(C-1, R+1)  ← faces LEFT... NO!
```

Wait — if chair is LEFT of desk, person looks RIGHT toward desk. Chair should face RIGHT:
```
Col C:   DESK_SIDE(C, R)          ← 1×4
         PC_SIDE(C, R+1)          ← on desk, screen faces LEFT toward chair (SAME variant as chair)
Col C-1: WOODEN_CHAIR_SIDE(C-1, R+1)  ← faces RIGHT toward desk ✓
```
Footprint: 2 wide × 4 tall. Seats: 1.

#### Template: Side Desk Workstation (chair to the RIGHT)
```
Col C:   DESK_SIDE(C, R)          ← 1×4
         PC_SIDE:left(C, R+1)     ← on desk, screen faces RIGHT toward chair (SAME variant as chair)
Col C+1: WOODEN_CHAIR_SIDE:left(C+1, R+1) ← faces LEFT toward desk ✓
```

#### Template: Meeting Table (4 seats, 4 PCs)
Anchor: table top-left at (C, R). TABLE_FRONT is 3×4, backgroundTiles=1.
```
         TABLE_FRONT(C, R)                         ← 3×4, rows R-R+3
Col C-1: WOODEN_CHAIR_SIDE(C-1, R+1)              ← faces RIGHT toward table ✓
         WOODEN_CHAIR_SIDE(C-1, R+3)               ← faces RIGHT toward table ✓
Col C:   PC_SIDE(C, R+1)                           ← on table, screen faces RIGHT toward chair at C-1 ✗!
```

NO — PC_SIDE faces RIGHT, toward the chair at C-1 which is LEFT. That's wrong. The PC at col C should face LEFT toward the chair at C-1:
```
Col C-1: WOODEN_CHAIR_SIDE(C-1, R+1)              ← faces RIGHT toward table
         WOODEN_CHAIR_SIDE(C-1, R+3)
Col C:   PC_SIDE(C, R+1)                           ← screen faces LEFT toward chair at C-1 ✓ (SAME variant as chair)
         PC_SIDE(C, R+3)
Col C+2: PC_SIDE:left(C+2, R+1)                    ← screen faces RIGHT toward chair at C+3 ✓ (SAME variant as chair)
         PC_SIDE:left(C+2, R+3)
Col C+3: WOODEN_CHAIR_SIDE:left(C+3, R+1)          ← faces LEFT toward table ✓
         WOODEN_CHAIR_SIDE:left(C+3, R+3)
```
Footprint: 5 wide × 4 tall. Seats: 4.

#### Template: Lounge (8 seats)
Anchor: coffee table top-left at (C, R). COFFEE_TABLE is 2×2.
```
SOFA_FRONT(C, R-1)                ← 2×1, faces DOWN toward table ✓
SOFA_SIDE(C-1, R)                 ← 1×2, faces RIGHT toward table ✓
COFFEE_TABLE(C, R)                ← 2×2 centerpiece
COFFEE(C, R+1)                    ← on table
SOFA_SIDE:left(C+2, R)            ← 1×2, faces LEFT toward table ✓
SOFA_BACK(C, R+2)                 ← 2×1, faces UP toward table ✓
```
Footprint: 4 wide × 4 tall. Seats: 8.

#### Template: Reading Nook (4 seats)
Anchor: table top-left at (C, R). SMALL_TABLE_FRONT is 2×2, backgroundTiles=1.
```
SMALL_TABLE_FRONT(C, R)                        ← 2×2
CUSHIONED_CHAIR_FRONT(C, R-1)                  ← faces DOWN toward table ✓
CUSHIONED_CHAIR_FRONT(C+1, R-1)                ← faces DOWN toward table ✓
CUSHIONED_CHAIR_BACK(C, R+2)                   ← faces UP toward table ✓
CUSHIONED_CHAIR_BACK(C+1, R+2)                 ← faces UP toward table ✓
```
Footprint: 2 wide × 4 tall. Seats: 4.

Or with side chairs (1 per side):
```
SMALL_TABLE_FRONT(C, R)
CUSHIONED_CHAIR_FRONT(C, R-1)                  ← top, faces DOWN ✓
CUSHIONED_CHAIR_BACK(C, R+2)                   ← bottom, faces UP ✓
CUSHIONED_CHAIR_SIDE(C-1, R)                   ← left of table, faces RIGHT ✓
CUSHIONED_CHAIR_SIDE:left(C+2, R)              ← right of table, faces LEFT ✓
```
Footprint: 4 wide × 4 tall. Seats: 4.

### Room Filling Algorithm

1. **Choose room type** (office, lounge, lab, library) — determines which furniture group templates to use
2. **Place wall art first** — on the top wall row, avoiding doorway columns. Choose from: DOUBLE_BOOKSHELF, BOOKSHELF, CLOCK, WHITEBOARD, LARGE_PAINTING, SMALL_PAINTING, SMALL_PAINTING_2, HANGING_PLANT
3. **Place primary furniture groups** — select 1-2 templates appropriate for the room type. Position them with at least 1-tile walkway between groups and from walls
4. **Place decorations** — fill corners and empty spaces with PLANT, PLANT_2, CACTUS, LARGE_PLANT, POT, BIN. Plants with backgroundTiles go against walls; small items (POT, BIN) fill corners
5. **Verify pathfinding** — BFS from every seat tile to every doorway. If any seat is unreachable, adjust furniture

### Room Type Presets

| Room Type | Primary Groups | Wall Art | Decor Style |
|-----------|---------------|----------|-------------|
| Office | 1-2 Front Workstations + 1 Meeting Table | Bookshelves, Clock | Bins, small plants |
| Lounge | 1 Lounge group + side table | Paintings | Plants, coffee, pot |
| Lab | 2 Front Workstations + 1 Side Desk | Whiteboard, Bookshelf | Cactus, plants |
| Library | 1 Reading Nook | Many bookshelves | Large plant, pots |

## Pathfinding Connectivity

- **Every floor tile must be reachable** from every other floor tile via 4-connected BFS (no diagonals)
- Doorways must connect all rooms — verify no isolated rooms
- Leave at least 1-tile-wide walkway between furniture clusters
- Characters need to reach their seats — ensure seat tiles have walkable neighbors
- Seat tiles (chair footprint tiles) are automatically excluded from blocked tiles

## Color Guidelines

- Each room should have a distinct floor color for visual identity
- Wall color should be consistent across the entire layout (dark, low saturation)
- Recommended wall color: `{h: 214, s: 30, b: -100, c: -55}`
- Floor colors should vary by hue, keeping similar brightness/contrast:
  - Brown/warm: `{h: 25, s: 48, b: -43, c: -88}` (office)
  - Blue/cool: `{h: 209, s: 39, b: -25, c: -80}` (lounge)
  - Green: `{h: 140, s: 35, b: -30, c: -70}` (lab)
  - Purple: `{h: 270, s: 30, b: -20, c: -75}` (library)
  - Warm gray: `{h: 30, s: 15, b: -10, c: -50}` (hallway)
  - Checkerboard: `{h: 209, s: 0, b: -16, c: -8}` (utility area)

## UID Convention

Furniture UIDs must be unique strings. Convention: `f-{timestamp}-{random4}` for editor-created items, or `f-{room}-{type}` for generator-created items.

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

- `tiles[r * cols + c]` = tile type at (col, row)
- `tileColors[r * cols + c]` = color for that tile (null for walls/void)
- `furniture[].col` and `.row` = top-left corner of the footprint
- `layoutRevision: 2` marks the layout as post-migration (prevents old VOID value rewrite)
