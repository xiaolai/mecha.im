import { describe, it, expect } from "vitest";
import { ZONES, zoneForActivity } from "./zones";
import type { ActivityState } from "./office-bridge";

describe("zones", () => {
  it("maps all activity states to a zone", () => {
    const activities: ActivityState[] = ["idle", "thinking", "calling", "scheduled", "webhook", "error"];
    for (const a of activities) {
      const zone = zoneForActivity(a);
      expect(zone).toBeDefined();
      expect(ZONES[zone]).toBeDefined();
    }
  });

  it("maps thinking→desk, idle→sofa, calling→phone", () => {
    expect(zoneForActivity("thinking")).toBe("desk");
    expect(zoneForActivity("idle")).toBe("sofa");
    expect(zoneForActivity("calling")).toBe("phone");
    expect(zoneForActivity("scheduled")).toBe("printer");
    expect(zoneForActivity("error")).toBe("server");
    expect(zoneForActivity("webhook")).toBe("door");
  });

  it("all zones have valid tile positions", () => {
    for (const [id, zone] of Object.entries(ZONES)) {
      expect(zone.tileX).toBeGreaterThanOrEqual(0);
      expect(zone.tileX).toBeLessThan(16);
      expect(zone.tileY).toBeGreaterThanOrEqual(0);
      expect(zone.tileY).toBeLessThan(14);
      expect(id).toBe(zone.id);
    }
  });

  it("each zone has a clickable item or is explicitly null", () => {
    expect(ZONES.desk.clickable).toBe("computer");
    expect(ZONES.phone.clickable).toBe("phone");
    expect(ZONES.sofa.clickable).toBeNull();
    expect(ZONES.printer.clickable).toBe("printer");
    expect(ZONES.server.clickable).toBe("server");
    expect(ZONES.door.clickable).toBe("door");
  });
});
