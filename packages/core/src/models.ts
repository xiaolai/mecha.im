export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Available Claude models for bot spawning.
 * Update this list when new models are released or old ones are retired.
 */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-5-20250514", label: "Sonnet 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
