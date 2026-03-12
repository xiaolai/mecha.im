/** Result shape returned by runClaude */
export interface QueryResult {
  text: string;
  costUsd: number;
  sessionId: string;
  durationMs: number;
  success: boolean;
}

// Typed SDK event shapes (the SDK emits plain objects; define the shapes we consume)
export interface SdkSystemEvent {
  type: "system";
  subtype?: string;
  session_id?: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

export interface SdkAssistantEvent {
  type: "assistant";
  message?: { content?: ContentBlock[] };
}

export interface SdkResultEvent {
  type: "result";
  subtype?: string;
  total_cost_usd?: number;
  session_id?: string;
  duration_ms?: number;
  result?: string;
}

export type SdkEvent = SdkSystemEvent | SdkAssistantEvent | SdkResultEvent | { type: string };
