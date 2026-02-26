/** SSE stream usage extraction for Anthropic Messages API */

export interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelActual: string;
  ttftMs: number | null;
}

/**
 * Parse SSE data lines from a chunk buffer and extract usage information.
 * Returns partial results — caller accumulates across chunks.
 */
export function parseSSEChunk(
  chunk: string,
  state: SSEParseState,
): void {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const json = line.slice(6);
    if (json === "[DONE]") continue;

    try {
      const data = JSON.parse(json) as Record<string, unknown>;
      const type = data.type as string | undefined;

      if (type === "message_start") {
        const message = data.message as Record<string, unknown> | undefined;
        if (message) {
          state.modelActual = (message.model as string) ?? state.modelActual;
          const usage = message.usage as Record<string, number> | undefined;
          if (usage) {
            state.inputTokens = usage.input_tokens ?? 0;
            state.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
            state.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          }
        }
      } else if (type === "content_block_delta") {
        if (state.ttftMs === null && state.requestStartMs > 0) {
          state.ttftMs = Date.now() - state.requestStartMs;
        }
      } else if (type === "message_delta") {
        const usage = data.usage as Record<string, number> | undefined;
        if (usage) {
          state.outputTokens = usage.output_tokens ?? state.outputTokens;
        }
      }
    } catch {
      // Malformed SSE data — skip, log is handled by caller
    }
  }
}

export interface SSEParseState {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelActual: string;
  ttftMs: number | null;
  requestStartMs: number;
}

export function createSSEParseState(requestStartMs: number, model: string): SSEParseState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    modelActual: model,
    ttftMs: null,
    requestStartMs,
  };
}

/** Extract usage from a non-streaming JSON response body */
export function extractNonStreamUsage(body: string): ExtractedUsage {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const usage = data.usage as Record<string, number> | undefined;
    return {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      modelActual: (data.model as string) ?? "",
      ttftMs: null,
    };
  } catch {
    /* v8 ignore start -- corrupt response body fallback */
    return {
      inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0,
      modelActual: "", ttftMs: null,
    };
    /* v8 ignore stop */
  }
}
