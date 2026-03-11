import { EventEmitter } from "node:events";

export type ActivityState = "idle" | "thinking" | "calling" | "scheduled" | "webhook" | "error";

export class ActivityTracker extends EventEmitter {
  private state: ActivityState = "idle";
  private talkingTo: string | null = null;
  private lastActive: string | null = null;

  getState(): ActivityState {
    return this.state;
  }

  getTalkingTo(): string | null {
    return this.talkingTo;
  }

  getLastActive(): string | null {
    return this.lastActive;
  }

  transition(newState: ActivityState, meta?: { talkingTo?: string }): void {
    const prev = this.state;
    this.state = newState;
    this.talkingTo = meta?.talkingTo ?? null;
    if (newState !== "idle") {
      this.lastActive = new Date().toISOString();
    }
    this.emit("change", { prev, state: newState, talkingTo: this.talkingTo });
  }
}
