import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityEmitter, type ActivityEvent } from "../src/activity.js";

// We test the emitActivityFromEvent helper (extracted for testability)
// rather than the full sdkChat (which requires SDK binary)
import { emitActivityFromEvent } from "../src/sdk-chat-activity.js";

describe("emitActivityFromEvent", () => {
  let emitter: ActivityEmitter;
  let events: ActivityEvent[];

  beforeEach(() => {
    emitter = new ActivityEmitter();
    events = [];
    emitter.subscribe((e) => events.push(e));
  });

  const ctx = { name: "alice", queryId: "q1" };

  it("emits thinking on system init event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "system", subtype: "init" });
    expect(events).toHaveLength(1);
    expect(events[0]!.activity).toBe("thinking");
    expect(events[0]!.name).toBe("alice");
    expect(events[0]!.queryId).toBe("q1");
  });

  it("emits thinking on system status event (all system subtypes map to thinking)", () => {
    emitActivityFromEvent(emitter, ctx, { type: "system", subtype: "status" });
    expect(events[0]!.activity).toBe("thinking");
  });

  it("emits responding on assistant event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "assistant" });
    expect(events[0]!.activity).toBe("responding");
  });

  it("emits tool_use on tool_use_summary event", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "tool_use_summary",
      tool_name: "Bash",
    });
    expect(events[0]!.activity).toBe("tool_use");
    expect(events[0]!.toolName).toBe("Bash");
  });

  it("emits tool_use on tool_progress event", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "tool_progress",
      tool_name: "Read",
    });
    expect(events[0]!.activity).toBe("tool_use");
    expect(events[0]!.toolName).toBe("Read");
  });

  it("emits responding on stream_event", () => {
    emitActivityFromEvent(emitter, ctx, { type: "stream_event" });
    expect(events[0]!.activity).toBe("responding");
  });

  it("emits idle on successful result", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "result",
      subtype: "success",
    });
    expect(events[0]!.activity).toBe("idle");
  });

  it("emits error on error result", () => {
    emitActivityFromEvent(emitter, ctx, {
      type: "result",
      subtype: "error_max_turns",
    });
    expect(events[0]!.activity).toBe("error");
  });

  it("ignores unknown event types", () => {
    emitActivityFromEvent(emitter, ctx, { type: "unknown_future_type" });
    expect(events).toHaveLength(0);
  });
});
