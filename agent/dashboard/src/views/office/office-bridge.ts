export type ActivityState = "idle" | "thinking" | "calling" | "scheduled" | "webhook" | "error";
export type ClickableItem = "computer" | "phone" | "printer" | "server" | "door" | "character";

export interface OfficeBridge {
  revision: number;
  state: {
    activity: ActivityState;
    talkingTo: string | null;
    currentTool: string | null;
    currentToolContext: string | null;
    subagents: { id: string; type: string; description: string }[];
    currentSessionId: string | null;
    taskStartedAt: string | null;
    costToday: number;
    consecutiveErrors: number;
    scheduleNextRunAt: string | null;
    ptyClientsConnected: number;
    idleSinceSec: number;
  };
  character: {
    skin: number;
    hair: number;
    outfit: string;
  };
  onFurnitureClick: ((item: ClickableItem) => void) | null;
}

export function createBridge(): OfficeBridge {
  return {
    revision: 0,
    state: {
      activity: "idle",
      talkingTo: null,
      currentTool: null,
      currentToolContext: null,
      subagents: [],
      currentSessionId: null,
      taskStartedAt: null,
      costToday: 0,
      consecutiveErrors: 0,
      scheduleNextRunAt: null,
      ptyClientsConnected: 0,
      idleSinceSec: 0,
    },
    character: { skin: 0, hair: 0, outfit: "outfit1" },
    onFurnitureClick: null,
  };
}
