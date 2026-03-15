import {
  IDLE_ACTIONS_BEFORE_REST_MAX,
  IDLE_ACTIONS_BEFORE_REST_MIN,
  LOUNGE_SIT_MIN_SEC,
  LOUNGE_SIT_MAX_SEC,
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
  WORK_DESK_DEPART_SEC,
} from '../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import type { OfficeState } from './officeState.js';

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return READING_TOOLS.has(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    homeSeatId: seatId,
    workDeskId: null,
    chatPartner: null,
    chatTimer: 0,
    interactTimer: 0,
    interactTarget: null,
    sitTimer: 0,
    idleActionCount: 0,
    idleActionLimit: randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX),
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
  };
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  officeState?: OfficeState,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        // Release work desk claim
        if (ch.workDeskId && officeState) {
          officeState.scheduler.releaseDeskClaim(ch.workDeskId);
          ch.workDeskId = null;
        }
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.idleActionCount = 0;
        ch.idleActionLimit = randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.SIT: {
      // Passive sitting (lounge or home seat rest) — no animation
      ch.frame = 0;
      ch.sitTimer -= dt;
      if (ch.sitTimer <= 0) {
        ch.idleActionCount++;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      // Preempt: if became active, go to work
      if (ch.isActive && officeState) {
        preemptForWork(ch, officeState, tileMap, blockedTiles, seats);
      }
      break;
    }

    case CharacterState.INTERACT: {
      // Standing in front of furniture or facing chat partner
      ch.frame = 0;
      ch.interactTimer -= dt;
      if (ch.interactTimer <= 0) {
        // Release furniture reservation
        if (ch.interactTarget && officeState) {
          officeState.scheduler.releaseFurniture(ch.interactTarget);
          ch.interactTarget = null;
        }
        // Release chat pairing
        if (ch.chatPartner !== null && officeState) {
          officeState.scheduler.chatPairs.delete(ch.id);
          officeState.scheduler.chatPairs.delete(ch.chatPartner);
          ch.chatPartner = null;
        }
        ch.chatTimer = 0;
        ch.idleActionCount++;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      // Preempt: if became active, go to work
      if (ch.isActive && officeState) {
        preemptForWork(ch, officeState, tileMap, blockedTiles, seats);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, claim desk and go work
      if (ch.isActive) {
        if (officeState) {
          preemptForWork(ch, officeState, tileMap, blockedTiles, seats);
        } else {
          // Legacy path without officeState
          if (!ch.seatId) {
            ch.state = CharacterState.TYPE;
            ch.frame = 0;
            ch.frameTimer = 0;
            break;
          }
          const seat = seats.get(ch.seatId);
          if (seat) {
            const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
            } else if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.frame = 0;
              ch.frameTimer = 0;
            }
          }
        }
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Use scheduler for weighted action selection if available
        if (officeState) {
          const action = officeState.scheduler.selectIdleAction(
            ch, officeState.characters, officeState.seats,
            officeState.layout.furniture, officeState.tileMap, officeState.blockedTiles,
          );

          switch (action.type) {
            case 'wander':
              doWander(ch, walkableTiles, tileMap, blockedTiles);
              break;
            case 'interact':
              ch.interactTarget = action.furnitureUid;
              ch.interactTimer = action.duration;
              ch.dir = action.facingDir as Direction;
              ch.path = findPath(ch.tileCol, ch.tileRow, action.tileCol, action.tileRow, tileMap, blockedTiles);
              if (ch.path.length > 0) {
                ch.moveProgress = 0;
                ch.state = CharacterState.WALK;
                ch.frame = 0;
                ch.frameTimer = 0;
              } else {
                // Can't reach — release and wander instead
                officeState.scheduler.releaseFurniture(action.furnitureUid);
                ch.interactTarget = null;
                doWander(ch, walkableTiles, tileMap, blockedTiles);
              }
              break;
            case 'chat':
              ch.chatPartner = action.partnerId;
              ch.chatTimer = action.duration;
              ch.dir = action.facingDir as Direction;
              ch.path = findPath(ch.tileCol, ch.tileRow, action.tileCol, action.tileRow, tileMap, blockedTiles);
              if (ch.path.length > 0) {
                ch.moveProgress = 0;
                ch.state = CharacterState.WALK;
                ch.frame = 0;
                ch.frameTimer = 0;
              } else {
                // Can't reach — release chat
                officeState.scheduler.chatPairs.delete(ch.id);
                if (ch.chatPartner !== null) officeState.scheduler.chatPairs.delete(ch.chatPartner);
                ch.chatPartner = null;
                ch.chatTimer = 0;
                doWander(ch, walkableTiles, tileMap, blockedTiles);
              }
              break;
            case 'lounge': {
              const seat = officeState.seats.get(action.seatUid);
              if (seat) {
                ch.path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
                if (ch.path.length > 0) {
                  ch.sitTimer = randomRange(LOUNGE_SIT_MIN_SEC, LOUNGE_SIT_MAX_SEC);
                  ch.moveProgress = 0;
                  ch.state = CharacterState.WALK;
                  ch.frame = 0;
                  ch.frameTimer = 0;
                } else {
                  doWander(ch, walkableTiles, tileMap, blockedTiles);
                }
              } else {
                doWander(ch, walkableTiles, tileMap, blockedTiles);
              }
              break;
            }
            case 'rest': {
              ch.idleActionCount = 0;
              ch.idleActionLimit = randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX);
              const homeSeat = ch.homeSeatId ? seats.get(ch.homeSeatId) : null;
              if (homeSeat) {
                ch.path = findPath(ch.tileCol, ch.tileRow, homeSeat.seatCol, homeSeat.seatRow, tileMap, blockedTiles);
                if (ch.path.length > 0) {
                  ch.moveProgress = 0;
                  ch.state = CharacterState.WALK;
                  ch.frame = 0;
                  ch.frameTimer = 0;
                }
              }
              break;
            }
          }
        } else {
          // Legacy path: just wander
          doWander(ch, walkableTiles, tileMap, blockedTiles);
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        // Check new destination types first
        if (ch.interactTarget) {
          // Arrived at furniture interaction point
          ch.state = CharacterState.INTERACT;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        if (ch.chatPartner !== null && ch.chatTimer > 0) {
          // Arrived at chat meeting point — face partner
          const partner = officeState?.characters.get(ch.chatPartner);
          if (partner) {
            ch.dir = directionBetween(ch.tileCol, ch.tileRow, partner.tileCol, partner.tileRow);
          }
          ch.interactTimer = ch.chatTimer;
          ch.state = CharacterState.INTERACT;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        if (ch.sitTimer > 0) {
          // Arrived at lounge seat — sit
          ch.state = CharacterState.SIT;
          const seat = [...seats.values()].find(s => s.seatCol === ch.tileCol && s.seatRow === ch.tileRow);
          if (seat) ch.dir = seat.facingDir;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }

        if (ch.isActive) {
          if (!ch.seatId && !ch.workDeskId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const activeSeatId = ch.workDeskId ?? ch.seatId;
            const seat = activeSeatId ? seats.get(activeSeatId) : null;
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Check if arrived at assigned home seat — sit down for a rest
          if (ch.homeSeatId) {
            const seat = seats.get(ch.homeSeatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.SIT;
              ch.dir = seat.facingDir;
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
                ch.sitTimer = 0.1; // quick transition
              } else {
                ch.sitTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.idleActionCount = 0;
              ch.idleActionLimit = randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX);
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          // Also check legacy seatId
          if (ch.seatId && ch.seatId !== ch.homeSeatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.SIT;
              ch.dir = seat.facingDir;
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
                ch.sitTimer = 0.1;
              } else {
                ch.sitTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.idleActionCount = 0;
              ch.idleActionLimit = randomInt(IDLE_ACTIONS_BEFORE_REST_MIN, IDLE_ACTIONS_BEFORE_REST_MAX);
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering, repath to work desk or seat
      if (ch.isActive) {
        const targetSeatId = ch.workDeskId ?? ch.seatId;
        if (targetSeatId) {
          const seat = seats.get(targetSeatId);
          if (seat) {
            const lastStep = ch.path[ch.path.length - 1];
            if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
              const newPath = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
              if (newPath.length > 0) {
                ch.path = newPath;
                ch.moveProgress = 0;
              }
            }
          }
        }
      }
      break;
    }
  }
}

/** Preempt current state: release reservations, claim work desk, path to it */
function preemptForWork(
  ch: Character,
  officeState: OfficeState,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  seats: Map<string, Seat>,
): void {
  // Release any transient reservations
  officeState.scheduler.releaseAll(ch.id);
  ch.interactTarget = null;
  ch.chatPartner = null;
  ch.interactTimer = 0;
  ch.sitTimer = 0;
  ch.chatTimer = 0;

  // Try to claim a PC desk
  const desk = officeState.claimDeskForAgent(ch.id);
  if (desk) {
    ch.workDeskId = desk.uid;
    ch.seatId = desk.uid; // for legacy auto-on detection
    const path = findPath(ch.tileCol, ch.tileRow, desk.seatCol, desk.seatRow, tileMap, blockedTiles);
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
      return;
    }
    // Already at desk
    if (ch.tileCol === desk.seatCol && ch.tileRow === desk.seatRow) {
      ch.state = CharacterState.TYPE;
      ch.dir = desk.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      return;
    }
  }

  // Fallback: use home seat
  const homeSeat = ch.homeSeatId ? seats.get(ch.homeSeatId) : null;
  if (homeSeat) {
    ch.seatId = ch.homeSeatId;
    const path = findPath(ch.tileCol, ch.tileRow, homeSeat.seatCol, homeSeat.seatRow, tileMap, blockedTiles);
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
      return;
    }
    if (ch.tileCol === homeSeat.seatCol && ch.tileRow === homeSeat.seatRow) {
      ch.state = CharacterState.TYPE;
      ch.dir = homeSeat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      return;
    }
  }

  // No seat available — type in place
  ch.state = CharacterState.TYPE;
  ch.frame = 0;
  ch.frameTimer = 0;
}

/** Pick random walkable tile and start walking there */
function doWander(
  ch: Character,
  walkableTiles: Array<{ col: number; row: number }>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  if (walkableTiles.length === 0) return;
  const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
  const path = findPath(ch.tileCol, ch.tileRow, target.col, target.row, tileMap, blockedTiles);
  if (path.length > 0) {
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    ch.idleActionCount++;
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.SIT:
      // Seated idle — use walk frame 1 (standing pose in sitting position)
      return sprites.walk[ch.dir][1];
    case CharacterState.INTERACT:
      // Standing in front of furniture — static standing pose
      return sprites.walk[ch.dir][1];
    case CharacterState.IDLE:
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
