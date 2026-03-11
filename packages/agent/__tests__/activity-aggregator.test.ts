import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityAggregator } from "../src/activity-aggregator.js";

describe("ActivityAggregator", () => {
  let aggregator: ActivityAggregator;

  beforeEach(() => {
    aggregator = new ActivityAggregator();
  });

  afterEach(() => {
    aggregator.shutdown();
  });

  it("emits events to subscribers", () => {
    const handler = vi.fn();
    aggregator.subscribe(handler);

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "thinking",
      timestamp: new Date().toISOString(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].activity).toBe("thinking");
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = aggregator.subscribe(handler);
    unsub();

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks connected bot names (skipConnect avoids real fetch)", () => {
    expect(aggregator.connectedBots).toEqual([]);
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    expect(aggregator.connectedBots).toContain("alice");
  });

  it("removes bot on removeBot", () => {
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    aggregator.removeBot("alice");
    expect(aggregator.connectedBots).not.toContain("alice");
  });

  it("cleans up all on shutdown", () => {
    aggregator.addBot("alice", 7700, "token-a", { skipConnect: true });
    aggregator.addBot("bob", 7701, "token-b", { skipConnect: true });
    aggregator.shutdown();
    expect(aggregator.connectedBots).toEqual([]);
  });

  it("isolates handler failures", () => {
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    aggregator.subscribe(bad);
    aggregator.subscribe(good);

    aggregator.injectEvent({
      type: "activity",
      name: "alice",
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    expect(good).toHaveBeenCalled();
  });
});
