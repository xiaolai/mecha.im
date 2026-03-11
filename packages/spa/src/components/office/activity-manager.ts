import type {
  ActivityEvent,
  ActivityState,
  BotState,
  GridPosition,
} from "./types";
import { DESK_POSITIONS, LOUNGE_POSITIONS, WATER_COOLER_POSITION } from "./types";

const DEBOUNCE_MS = 500;

/**
 * Manages per-bot state for the office visualization.
 * Consumes SSE ActivityEvents and maintains positions + animation state.
 */
export class OfficeActivityManager {
  private bots = new Map<string, BotState>();
  private nextDeskIndex = 0;
  private assignedDesks = new Map<string, number>();

  handleEvent(event: ActivityEvent): void {
    let state = this.bots.get(event.name);

    if (!state) {
      const deskIndex = this.assignDesk(event.name);
      const position = this.getIdlePosition(event.name);
      state = {
        name: event.name,
        activity: "idle",
        position: { ...position },
        targetPosition: { ...position },
        toolName: undefined,
        sessionId: undefined,
        deskIndex,
        lastActivityChange: Date.now(),
      };
      this.bots.set(event.name, state);
    }

    // Update activity
    state.activity = event.activity;
    state.toolName = event.toolName;
    state.sessionId = event.sessionId;

    // Update target position based on activity
    const now = Date.now();
    const timeSinceLastChange = now - state.lastActivityChange;
    state.lastActivityChange = now;

    if (this.isWorkingState(event.activity)) {
      // Move to desk
      const deskPos = DESK_POSITIONS[state.deskIndex % DESK_POSITIONS.length]!;
      if (timeSinceLastChange >= DEBOUNCE_MS || !this.isWorkingState(state.activity)) {
        state.targetPosition = { ...deskPos };
      }
    } else if (event.activity === "idle") {
      // Move to lounge or water cooler
      const idlePos = this.getIdlePosition(event.name);
      state.targetPosition = { ...idlePos };
    }
    // error: stay at current position
  }

  getBotState(name: string): BotState | undefined {
    return this.bots.get(name);
  }

  getAllBotStates(): BotState[] {
    return [...this.bots.values()];
  }

  removeBot(name: string): void {
    this.bots.delete(name);
    this.assignedDesks.delete(name);
  }

  private isWorkingState(activity: ActivityState): boolean {
    return activity === "thinking" || activity === "tool_use" || activity === "responding";
  }

  private assignDesk(name: string): number {
    if (this.assignedDesks.has(name)) {
      return this.assignedDesks.get(name)!;
    }
    const index = this.nextDeskIndex++;
    this.assignedDesks.set(name, index);
    return index;
  }

  private getIdlePosition(name: string): GridPosition {
    // If multiple bots idle, some go to water cooler
    const idleBots = [...this.bots.values()].filter(b => b.activity === "idle");
    const idleIndex = idleBots.findIndex(b => b.name === name);

    if (idleBots.length >= 2 && idleIndex < 2) {
      return { ...WATER_COOLER_POSITION };
    }

    const loungeIndex = Math.max(0, idleIndex) % LOUNGE_POSITIONS.length;
    return { ...LOUNGE_POSITIONS[loungeIndex]! };
  }
}
