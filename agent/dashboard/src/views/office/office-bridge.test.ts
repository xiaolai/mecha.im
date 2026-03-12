import { describe, it, expect } from "vitest";
import { createBridge } from "./office-bridge";

describe("OfficeBridge", () => {
  it("creates with default state", () => {
    const bridge = createBridge();
    expect(bridge.revision).toBe(0);
    expect(bridge.state.activity).toBe("idle");
    expect(bridge.state.subagents).toEqual([]);
    expect(bridge.state.costToday).toBe(0);
    expect(bridge.character.skin).toBe(0);
    expect(bridge.onFurnitureClick).toBeNull();
  });

  it("incrementRevision bumps revision", () => {
    const bridge = createBridge();
    expect(bridge.revision).toBe(0);
    bridge.revision++;
    expect(bridge.revision).toBe(1);
  });
});
