import type { Character, Seat, PlacedFurniture, TileType } from '../types.js';
import { CharacterState, Direction } from '../types.js';
import {
  CHAT_RANGE_TILES,
  CHAT_MIN_SEC,
  CHAT_MAX_SEC,
  INTERACT_MIN_SEC,
  INTERACT_MAX_SEC,
  LOUNGE_SIT_MIN_SEC,
  LOUNGE_SIT_MAX_SEC,
  IDLE_WEIGHT_WANDER,
  IDLE_WEIGHT_INTERACT,
  IDLE_WEIGHT_CHAT,
  IDLE_WEIGHT_LOUNGE,
} from '../constants.js';
import type { CatalogEntryWithCategory } from '../layout/furnitureCatalog.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { findPath } from '../layout/tileMap.js';

export type IdleAction =
  | { type: 'wander' }
  | {
      type: 'interact';
      furnitureUid: string;
      tileCol: number;
      tileRow: number;
      facingDir: number;
      duration: number;
    }
  | {
      type: 'chat';
      partnerId: number;
      tileCol: number;
      tileRow: number;
      facingDir: number;
      duration: number;
    }
  | { type: 'lounge'; seatUid: string }
  | { type: 'rest' };

export class InteractionScheduler {
  /** furniture uid → character id */
  furnitureReservations = new Map<string, number>();
  /** character id → partner id (symmetric) */
  chatPairs = new Map<number, number>();
  /** seat uid → character id (work desks) */
  deskClaims = new Map<string, number>();
  /** Pending chat requests from SSE (sub-agent spawns) */
  pendingRealChats: Array<{ parentId: number; childId: number }> = [];

  /** Release all reservations for a character (on preemption, despawn, etc.) */
  releaseAll(charId: number, characters?: Map<number, Character>): void {
    for (const [uid, id] of this.furnitureReservations) {
      if (id === charId) this.furnitureReservations.delete(uid);
    }
    const partnerId = this.chatPairs.get(charId);
    if (partnerId !== undefined) {
      this.chatPairs.delete(charId);
      this.chatPairs.delete(partnerId);
      // Cancel partner's chat state so they don't keep walking/interacting with nobody
      if (characters) {
        const partner = characters.get(partnerId);
        if (partner && partner.chatPartner === charId) {
          partner.chatPartner = null;
          partner.chatTimer = 0;
          partner.interactTimer = 0;
          if (partner.state === CharacterState.INTERACT || partner.state === CharacterState.WALK) {
            partner.state = CharacterState.IDLE;
            partner.path = [];
            partner.moveProgress = 0;
          }
        }
      }
    }
    for (const [uid, id] of this.deskClaims) {
      if (id === charId) this.deskClaims.delete(uid);
    }
  }

  /** Select next idle action for a character */
  selectIdleAction(
    char: Character,
    characters: Map<number, Character>,
    seats: Map<string, Seat>,
    furniture: PlacedFurniture[],
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): IdleAction {
    // Check if should rest
    if (char.idleActionCount >= char.idleActionLimit) {
      return { type: 'rest' };
    }

    // Weighted random selection with fallback
    const roll = Math.random() * 100;
    const thresholds = [
      IDLE_WEIGHT_WANDER,
      IDLE_WEIGHT_WANDER + IDLE_WEIGHT_INTERACT,
      IDLE_WEIGHT_WANDER + IDLE_WEIGHT_INTERACT + IDLE_WEIGHT_CHAT,
      100,
    ];

    if (roll < thresholds[0]) return { type: 'wander' };

    if (roll < thresholds[1]) {
      const action = this.tryInteractAction(char, furniture, tileMap, blockedTiles);
      if (action) return action;
      return { type: 'wander' }; // fallback
    }

    if (roll < thresholds[2]) {
      const action = this.tryChatAction(char, characters, tileMap, blockedTiles);
      if (action) return action;
      return { type: 'wander' }; // fallback
    }

    const action = this.tryLoungeAction(char, seats);
    if (action) return action;
    return { type: 'wander' }; // fallback
  }

  /** Try to find interactable furniture and reserve it */
  private tryInteractAction(
    char: Character,
    furniture: PlacedFurniture[],
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): IdleAction | null {
    // Get interactable furniture not already reserved
    const candidates = furniture.filter((f) => {
      const entry = getCatalogEntry(f.type);
      return entry?.interactable && !this.furnitureReservations.has(f.uid);
    });
    if (candidates.length === 0) return null;

    // Pick random, find adjacent walkable tile
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    for (const f of shuffled) {
      const entry = getCatalogEntry(f.type)!;
      const sides = entry.interactSides ?? ['front'];
      const tile = this.findInteractionTile(f, entry, sides, tileMap, blockedTiles);
      if (!tile) continue;

      // Check pathfinding
      const path = findPath(
        char.tileCol,
        char.tileRow,
        tile.col,
        tile.row,
        tileMap,
        blockedTiles,
      );
      if (path.length === 0 && (char.tileCol !== tile.col || char.tileRow !== tile.row)) continue;

      this.furnitureReservations.set(f.uid, char.id);
      const duration =
        INTERACT_MIN_SEC + Math.random() * (INTERACT_MAX_SEC - INTERACT_MIN_SEC);
      return {
        type: 'interact',
        furnitureUid: f.uid,
        tileCol: tile.col,
        tileRow: tile.row,
        facingDir: tile.dir,
        duration,
      };
    }
    return null;
  }

  /** Find a walkable tile adjacent to furniture on an allowed side */
  private findInteractionTile(
    f: PlacedFurniture,
    entry: CatalogEntryWithCategory,
    sides: string[],
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): { col: number; row: number; dir: number } | null {
    const fw = entry.footprintW,
      fh = entry.footprintH;
    const candidates: Array<{ col: number; row: number; dir: number }> = [];

    for (const side of sides) {
      if (side === 'front' || side === 'any') {
        // Row below furniture, facing UP
        for (let c = f.col; c < f.col + fw; c++) {
          candidates.push({ col: c, row: f.row + fh, dir: Direction.UP });
        }
      }
      if (side === 'back' || side === 'any') {
        for (let c = f.col; c < f.col + fw; c++) {
          candidates.push({ col: c, row: f.row - 1, dir: Direction.DOWN });
        }
      }
      if (side === 'left' || side === 'any') {
        for (let r = f.row; r < f.row + fh; r++) {
          candidates.push({ col: f.col - 1, row: r, dir: Direction.RIGHT });
        }
      }
      if (side === 'right' || side === 'any') {
        for (let r = f.row; r < f.row + fh; r++) {
          candidates.push({ col: f.col + fw, row: r, dir: Direction.LEFT });
        }
      }
    }

    // Filter to walkable, non-blocked tiles
    const rows = tileMap.length,
      cols = tileMap[0]?.length ?? 0;
    const valid = candidates.filter(
      (t) =>
        t.col >= 0 &&
        t.col < cols &&
        t.row >= 0 &&
        t.row < rows &&
        tileMap[t.row][t.col] > 0 &&
        tileMap[t.row][t.col] < 255 &&
        !blockedTiles.has(`${t.col},${t.row}`),
    );

    if (valid.length === 0) return null;
    return valid[Math.floor(Math.random() * valid.length)];
  }

  /** Try to pair this character with another idle bot for chat */
  private tryChatAction(
    char: Character,
    characters: Map<number, Character>,
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): IdleAction | null {
    // Find idle bots not in chat, within range
    const candidates: Character[] = [];
    for (const other of characters.values()) {
      if (other.id === char.id) continue;
      if (other.state !== CharacterState.IDLE) continue;
      if (other.isActive) continue;
      if (this.chatPairs.has(other.id)) continue;
      if (other.isSubagent) continue;
      const dist =
        Math.abs(other.tileCol - char.tileCol) + Math.abs(other.tileRow - char.tileRow);
      if (dist <= CHAT_RANGE_TILES) candidates.push(other);
    }
    if (candidates.length === 0) return null;

    // Pick closest
    candidates.sort((a, b) => {
      const da = Math.abs(a.tileCol - char.tileCol) + Math.abs(a.tileRow - char.tileRow);
      const db = Math.abs(b.tileCol - char.tileCol) + Math.abs(b.tileRow - char.tileRow);
      return da - db;
    });
    const partner = candidates[0];

    // Find two adjacent tiles facing each other (midpoint search)
    const midCol = Math.round((char.tileCol + partner.tileCol) / 2);
    const midRow = Math.round((char.tileRow + partner.tileRow) / 2);
    const meetTiles = this.findChatMeetingTiles(midCol, midRow, tileMap, blockedTiles);
    if (!meetTiles) return null;

    // Verify both can reach meeting tiles before reserving
    const pathA = findPath(char.tileCol, char.tileRow, meetTiles.a.col, meetTiles.a.row, tileMap, blockedTiles);
    const pathB = findPath(partner.tileCol, partner.tileRow, meetTiles.b.col, meetTiles.b.row, tileMap, blockedTiles);
    const charAtTarget = char.tileCol === meetTiles.a.col && char.tileRow === meetTiles.a.row;
    const partnerAtTarget = partner.tileCol === meetTiles.b.col && partner.tileRow === meetTiles.b.row;
    if ((pathA.length === 0 && !charAtTarget) || (pathB.length === 0 && !partnerAtTarget)) return null;

    // Reserve both
    const duration = CHAT_MIN_SEC + Math.random() * (CHAT_MAX_SEC - CHAT_MIN_SEC);
    this.chatPairs.set(char.id, partner.id);
    this.chatPairs.set(partner.id, char.id);

    // Assign partner's action directly
    partner.chatPartner = char.id;
    partner.path = pathB;
    partner.state = CharacterState.WALK;
    partner.chatTimer = duration;

    return {
      type: 'chat',
      partnerId: partner.id,
      tileCol: meetTiles.a.col,
      tileRow: meetTiles.a.row,
      facingDir: meetTiles.a.dir,
      duration,
    };
  }

  /** Find two adjacent walkable tiles facing each other near a target point */
  private findChatMeetingTiles(
    centerCol: number,
    centerRow: number,
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): {
    a: { col: number; row: number; dir: number };
    b: { col: number; row: number; dir: number };
  } | null {
    const rows = tileMap.length,
      cols = tileMap[0]?.length ?? 0;
    const isWalkable = (c: number, r: number) =>
      c >= 0 &&
      c < cols &&
      r >= 0 &&
      r < rows &&
      tileMap[r][c] > 0 &&
      tileMap[r][c] < 255 &&
      !blockedTiles.has(`${c},${r}`);

    // Search in expanding radius from center
    for (let radius = 0; radius < 8; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          const c = centerCol + dc,
            r = centerRow + dr;
          // Try horizontal pair
          if (isWalkable(c, r) && isWalkable(c + 1, r)) {
            return {
              a: { col: c, row: r, dir: Direction.RIGHT },
              b: { col: c + 1, row: r, dir: Direction.LEFT },
            };
          }
          // Try vertical pair
          if (isWalkable(c, r) && isWalkable(c, r + 1)) {
            return {
              a: { col: c, row: r, dir: Direction.DOWN },
              b: { col: c, row: r + 1, dir: Direction.UP },
            };
          }
        }
      }
    }
    return null;
  }

  /** Try to find a lounge seat */
  private tryLoungeAction(char: Character, seats: Map<string, Seat>): IdleAction | null {
    const loungeSeats = [...seats.values()].filter(
      (s) => s.kind === 'lounge' && !s.assigned && !this.deskClaims.has(s.uid),
    );
    if (loungeSeats.length === 0) return null;
    const seat = loungeSeats[Math.floor(Math.random() * loungeSeats.length)];
    return { type: 'lounge', seatUid: seat.uid };
  }

  /** Claim nearest available PC desk for an active bot. Returns seat or null. */
  claimDeskSeat(
    char: Character,
    seats: Map<string, Seat>,
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): Seat | null {
    const candidates = [...seats.values()].filter(
      (s) => s.kind === 'desk' && s.hasPc && !this.deskClaims.has(s.uid),
    );
    if (candidates.length === 0) return null;

    // Sort by Manhattan distance
    candidates.sort((a, b) => {
      const da =
        Math.abs(a.seatCol - char.tileCol) + Math.abs(a.seatRow - char.tileRow);
      const db =
        Math.abs(b.seatCol - char.tileCol) + Math.abs(b.seatRow - char.tileRow);
      return da - db;
    });

    // Pick nearest reachable
    for (const seat of candidates) {
      const path = findPath(
        char.tileCol,
        char.tileRow,
        seat.seatCol,
        seat.seatRow,
        tileMap,
        blockedTiles,
      );
      if (path.length > 0 || (char.tileCol === seat.seatCol && char.tileRow === seat.seatRow)) {
        this.deskClaims.set(seat.uid, char.id);
        return seat;
      }
    }
    return null;
  }

  /** Release desk claim when character leaves */
  releaseDeskClaim(seatUid: string): void {
    this.deskClaims.delete(seatUid);
  }

  /** Release furniture reservation */
  releaseFurniture(furnitureUid: string): void {
    this.furnitureReservations.delete(furnitureUid);
  }

  /** Trigger a real chat from SSE sub-agent spawn */
  requestRealChat(parentId: number, childId: number): void {
    this.pendingRealChats.push({ parentId, childId });
  }

  /** Process pending real chats (called from OfficeState.update each frame) */
  processPendingChats(
    characters: Map<number, Character>,
    tileMap: TileType[][],
    blockedTiles: Set<string>,
  ): void {
    while (this.pendingRealChats.length > 0) {
      const { parentId, childId } = this.pendingRealChats.shift()!;
      const parent = characters.get(parentId);
      const child = characters.get(childId);
      if (!parent || !child) continue;
      if (parent.isActive || child.isActive) continue;
      if (this.chatPairs.has(parentId) || this.chatPairs.has(childId)) continue;

      const midCol = Math.round((parent.tileCol + child.tileCol) / 2);
      const midRow = Math.round((parent.tileRow + child.tileRow) / 2);
      const meetTiles = this.findChatMeetingTiles(midCol, midRow, tileMap, blockedTiles);
      if (!meetTiles) continue;

      // Verify both can reach meeting tiles
      const pathP = findPath(parent.tileCol, parent.tileRow, meetTiles.a.col, meetTiles.a.row, tileMap, blockedTiles);
      const pathC = findPath(child.tileCol, child.tileRow, meetTiles.b.col, meetTiles.b.row, tileMap, blockedTiles);
      const parentAtTarget = parent.tileCol === meetTiles.a.col && parent.tileRow === meetTiles.a.row;
      const childAtTarget = child.tileCol === meetTiles.b.col && child.tileRow === meetTiles.b.row;
      if ((pathP.length === 0 && !parentAtTarget) || (pathC.length === 0 && !childAtTarget)) continue;

      const duration = CHAT_MIN_SEC + Math.random() * (CHAT_MAX_SEC - CHAT_MIN_SEC);
      this.chatPairs.set(parentId, childId);
      this.chatPairs.set(childId, parentId);

      parent.chatPartner = childId;
      parent.chatTimer = duration;
      parent.path = pathP;
      parent.state = parentAtTarget ? CharacterState.INTERACT : CharacterState.WALK;
      if (parentAtTarget) parent.interactTimer = duration;

      child.chatPartner = parentId;
      child.chatTimer = duration;
      child.path = pathC;
      child.state = childAtTarget ? CharacterState.INTERACT : CharacterState.WALK;
      if (childAtTarget) child.interactTimer = duration;
    }
  }
}
