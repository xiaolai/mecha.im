/** Activity states matching backend ActivityState. */
export type ActivityState = "idle" | "thinking" | "tool_use" | "responding" | "error";

/** Activity event from daemon SSE. */
export interface ActivityEvent {
  type: "activity";
  name: string;
  activity: ActivityState;
  toolName?: string;
  sessionId?: string;
  queryId?: string;
  timestamp: string;
}

/** Position on the canvas grid. */
export interface GridPosition {
  x: number;
  y: number;
}

/** Per-bot state tracked by the activity manager. */
export interface BotState {
  name: string;
  activity: ActivityState;
  position: GridPosition;
  targetPosition: GridPosition;
  toolName?: string;
  sessionId?: string;
  deskIndex: number;
  lastActivityChange: number;
}

/** Room positions (tile coordinates). */
export const DESK_POSITIONS: GridPosition[] = [
  { x: 2, y: 4 },   // Desk 1
  { x: 6, y: 4 },   // Desk 2
  { x: 2, y: 7 },   // Desk 3
  { x: 6, y: 7 },   // Desk 4
  { x: 2, y: 10 },  // Desk 5
  { x: 6, y: 10 },  // Desk 6
];

export const LOUNGE_POSITIONS: GridPosition[] = [
  { x: 12, y: 4 },  // Couch 1
  { x: 12, y: 7 },  // Couch 2
];

export const WATER_COOLER_POSITION: GridPosition = { x: 2, y: 2 };
