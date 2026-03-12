import { EventEmitter } from "node:events";

/** Shared emitter for tool + subagent events consumed by the SSE stream. */
export const officeEvents = new EventEmitter();
officeEvents.setMaxListeners(50); // Multiple SSE clients

export interface ToolEvent {
  name: string;
  context: string;
}

export interface SubagentEvent {
  action: "spawn" | "complete";
  id: string;
  type?: string;
  description?: string;
}
