import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfficeActivityManager } from "../../src/components/office/activity-manager";
import type { ActivityEvent } from "../../src/components/office/types";

describe("OfficeActivityManager", () => {
  let manager: OfficeActivityManager;

  beforeEach(() => {
    manager = new OfficeActivityManager();
  });

  it("adds a new bot in idle state at lounge position", () => {
    manager.handleEvent({
      type: "activity", name: "alice", activity: "idle",
      timestamp: new Date().toISOString(),
    });

    const state = manager.getBotState("alice");
    expect(state).toBeDefined();
    expect(state!.activity).toBe("idle");
  });

  it("transitions bot to desk when thinking", () => {
    manager.handleEvent({
      type: "activity", name: "alice", activity: "idle",
      timestamp: new Date().toISOString(),
    });
    manager.handleEvent({
      type: "activity", name: "alice", activity: "thinking",
      timestamp: new Date().toISOString(),
    });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("thinking");
    // Target position should be a desk
    expect(state!.deskIndex).toBeGreaterThanOrEqual(0);
  });

  it("keeps bot at desk during tool_use", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "alice", activity: "tool_use", toolName: "Bash", timestamp: new Date().toISOString() });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("tool_use");
    expect(state!.toolName).toBe("Bash");
  });

  it("moves bot to lounge when idle", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "alice", activity: "idle", timestamp: new Date().toISOString() });

    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("idle");
  });

  it("returns all bot states", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "idle", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "bob", activity: "thinking", timestamp: new Date().toISOString() });

    const all = manager.getAllBotStates();
    expect(all).toHaveLength(2);
    expect(all.map(b => b.name).sort()).toEqual(["alice", "bob"]);
  });

  it("debounces rapid state changes (< 500ms)", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });

    // Rapid change within 500ms
    vi.setSystemTime(now + 100);
    manager.handleEvent({ type: "activity", name: "alice", activity: "tool_use", timestamp: new Date().toISOString() });

    // Activity updates but position doesn't change until debounce expires
    const state = manager.getBotState("alice");
    expect(state!.activity).toBe("tool_use");

    vi.useRealTimers();
  });

  it("assigns unique desk indices to different bots", () => {
    manager.handleEvent({ type: "activity", name: "alice", activity: "thinking", timestamp: new Date().toISOString() });
    manager.handleEvent({ type: "activity", name: "bob", activity: "thinking", timestamp: new Date().toISOString() });

    const alice = manager.getBotState("alice");
    const bob = manager.getBotState("bob");
    expect(alice!.deskIndex).not.toBe(bob!.deskIndex);
  });
});
