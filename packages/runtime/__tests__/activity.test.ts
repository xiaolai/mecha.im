// packages/runtime/__tests__/activity.test.ts
import { describe, it, expect, vi } from "vitest";
import { ActivityEmitter, type ActivityEvent } from "../src/activity.js";

describe("ActivityEmitter", () => {
  it("emits events to subscribers", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const event: ActivityEvent = {
      type: "activity",
      name: "alice",
      activity: "thinking",
      timestamp: new Date().toISOString(),
    };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("unsubscribe stops delivery", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    const unsub = emitter.subscribe(handler);
    unsub();

    emitter.emit({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates handler failures", () => {
    const emitter = new ActivityEmitter();
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    emitter.subscribe(bad);
    emitter.subscribe(good);

    emitter.emit({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(good).toHaveBeenCalled();
  });

  it("reports listenerCount", () => {
    const emitter = new ActivityEmitter();
    expect(emitter.listenerCount).toBe(0);
    const unsub = emitter.subscribe(() => {});
    expect(emitter.listenerCount).toBe(1);
    unsub();
    expect(emitter.listenerCount).toBe(0);
  });

  it("deduplicates consecutive identical states for same bot+queryId", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows same state for different queryIds", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "thinking", queryId: "q1" });
    emitter.emit({ ...base, activity: "thinking", queryId: "q2" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("allows same state+queryId for different bots (no cross-bot dedup)", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const ts = new Date().toISOString();
    emitter.emit({ type: "activity", name: "alice", activity: "thinking", queryId: "q1", timestamp: ts });
    emitter.emit({ type: "activity", name: "bob", activity: "thinking", queryId: "q1", timestamp: ts });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("emits consecutive error events (error clears dedup state)", () => {
    const emitter = new ActivityEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const base = { type: "activity" as const, name: "alice", queryId: "q1", timestamp: new Date().toISOString() };
    emitter.emit({ ...base, activity: "error" });
    emitter.emit({ ...base, activity: "error" });

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
