// ---------------------------------------------------------------------------
// JSONL entry types — raw lines from Claude Code session transcript files
// ---------------------------------------------------------------------------

/** A single content block inside a user or assistant message. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

/** Token usage attached to an assistant message. */
export interface MessageUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// --- Raw JSONL line shapes (discriminated on `type`) ---

export interface JsonlUser {
  type: "user";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  message: {
    role: "user";
    content: ContentBlock[] | string;
  };
}

export interface JsonlAssistant {
  type: "assistant";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  message: {
    role: "assistant";
    model?: string;
    id?: string;
    content: ContentBlock[];
    usage?: MessageUsage;
  };
}

export interface JsonlProgress {
  type: "progress";
  data: Record<string, unknown>;
  toolUseID?: string;
}

export interface JsonlSystem {
  type: "system";
  subtype?: string;
  content?: string;
}

export interface JsonlFileSnapshot {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: Record<string, unknown>;
}

export interface JsonlQueueOp {
  type: "queue-operation";
  operation: string;
  timestamp: string;
  sessionId: string;
}

export type JsonlEntry =
  | JsonlUser
  | JsonlAssistant
  | JsonlProgress
  | JsonlSystem
  | JsonlFileSnapshot
  | JsonlQueueOp;

// ---------------------------------------------------------------------------
// Parsed output types — consumer-facing
// ---------------------------------------------------------------------------

/** A single parsed message (user or assistant). */
export interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  role: "user" | "assistant";
  content: ContentBlock[];
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  timestamp: Date;
}

/** Lightweight session summary — extracted without full-parsing the JSONL. */
export interface SessionSummary {
  /** JSONL filename UUID — canonical session ID. */
  id: string;
  /** Project slug directory name (e.g. "-home-mecha"). */
  projectSlug: string;
  /** First user message text, truncated. */
  title: string;
  /** Count of user + assistant messages only. */
  messageCount: number;
  /** Last-seen model name. */
  model?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Fully-parsed session with all messages. */
export interface ParsedSession extends SessionSummary {
  messages: ParsedMessage[];
}
