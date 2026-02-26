import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSSEChunk, createSSEParseState, extractNonStreamUsage } from "../src/stream.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("stream", () => {
  describe("parseSSEChunk", () => {
    it("extracts usage from streaming success fixture", () => {
      const fixture = readFileSync(join(fixturesDir, "stream-success.txt"), "utf-8");
      const state = createSSEParseState(Date.now() - 100, "claude-sonnet-4-6");
      parseSSEChunk(fixture, state);

      expect(state.inputTokens).toBe(25);
      expect(state.outputTokens).toBe(12);
      expect(state.cacheCreationTokens).toBe(0);
      expect(state.cacheReadTokens).toBe(100);
      expect(state.modelActual).toBe("claude-sonnet-4-6");
      expect(state.ttftMs).toBeGreaterThanOrEqual(0);
    });

    it("handles empty chunk", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk("", state);
      expect(state.inputTokens).toBe(0);
    });

    it("handles malformed JSON in data lines", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk("data: {invalid json}\n", state);
      expect(state.inputTokens).toBe(0);
    });

    it("handles [DONE] token", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk("data: [DONE]\n", state);
      expect(state.inputTokens).toBe(0);
    });

    it("handles message_start without usage", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk('data: {"type":"message_start","message":{"model":"m"}}\n', state);
      expect(state.modelActual).toBe("m");
      expect(state.inputTokens).toBe(0);
    });

    it("handles message_start without message", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk('data: {"type":"message_start"}\n', state);
      expect(state.modelActual).toBe("model");
    });

    it("handles message_start with null model and missing usage fields", () => {
      const state = createSSEParseState(Date.now(), "original");
      // model is null → should fall back to state.modelActual
      // usage has no input_tokens → should fall back to 0
      parseSSEChunk('data: {"type":"message_start","message":{"model":null,"usage":{}}}\n', state);
      expect(state.modelActual).toBe("original");
      expect(state.inputTokens).toBe(0);
    });

    it("handles message_delta with null output_tokens", () => {
      const state = createSSEParseState(Date.now(), "model");
      state.outputTokens = 42;
      parseSSEChunk('data: {"type":"message_delta","usage":{"output_tokens":null}}\n', state);
      expect(state.outputTokens).toBe(42);
    });

    it("handles message_delta without usage", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk('data: {"type":"message_delta"}\n', state);
      expect(state.outputTokens).toBe(0);
    });

    it("ignores non-data lines", () => {
      const state = createSSEParseState(Date.now(), "model");
      parseSSEChunk("event: ping\nid: 123\n: comment\n", state);
      expect(state.inputTokens).toBe(0);
    });

    it("records ttft only on first content_block_delta", () => {
      const state = createSSEParseState(Date.now() - 50, "model");
      const chunk = [
        'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"b"}}',
      ].join("\n");
      parseSSEChunk(chunk, state);
      const ttft = state.ttftMs!;
      expect(ttft).toBeGreaterThanOrEqual(0);
      // Parse another delta — ttft should NOT change
      parseSSEChunk('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"c"}}', state);
      expect(state.ttftMs).toBe(ttft);
    });
  });

  describe("extractNonStreamUsage", () => {
    it("extracts usage from non-streaming fixture", () => {
      const fixture = readFileSync(join(fixturesDir, "non-stream-success.json"), "utf-8");
      const usage = extractNonStreamUsage(fixture);

      expect(usage.inputTokens).toBe(25);
      expect(usage.outputTokens).toBe(12);
      expect(usage.cacheCreationTokens).toBe(0);
      expect(usage.cacheReadTokens).toBe(100);
      expect(usage.modelActual).toBe("claude-sonnet-4-6");
      expect(usage.ttftMs).toBeNull();
    });

    it("returns zeros for missing usage field", () => {
      const usage = extractNonStreamUsage('{"model":"test","content":[]}');
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.modelActual).toBe("test");
    });

    it("returns empty model when model field missing", () => {
      const usage = extractNonStreamUsage('{"content":[]}');
      expect(usage.modelActual).toBe("");
    });
  });
});
