export interface SearchMatch {
  role: "user" | "assistant";
  snippet: string;
  timestamp: string;
}

export interface SearchResult {
  id: string;
  title: string;
  model: string;
  lastActivity: string;
  hasPty: boolean;
  matches: SearchMatch[];
}

export interface SessionSummary {
  id: string;
  title: string;
  timestamp: string;
  lastActivity: string;
  model: string;
  messageCount: number;
  costUsd: number;
  hasPty: boolean;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  toolResultContent?: string;
  model?: string;
  thinkingContent?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SessionDetail {
  id: string;
  messages: ConversationMessage[];
  totalCostUsd: number;
  model: string;
}

// --- JSONL line types ---

export interface JLine {
  type: string;
  timestamp?: string;
  sessionId?: string;
  isMeta?: boolean;
  uuid?: string;
  parentUuid?: string | null;
  message?: {
    role?: string;
    model?: string;
    content?: string | JContentBlock[];
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  toolUseResult?: unknown;
  tool_use_id?: string;
  sourceToolAssistantUUID?: string;
}

export interface JContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | JContentBlock[];
}
