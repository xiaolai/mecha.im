import { describe, it, expect } from "vitest";
import { DEFAULTS } from "../src/constants.js";

describe("DEFAULTS", () => {
  it("has valid port range", () => {
    expect(DEFAULTS.PORT_BASE).toBeLessThan(DEFAULTS.PORT_MAX);
  });

  it("has stop timeout in milliseconds", () => {
    expect(DEFAULTS.STOP_TIMEOUT_MS).toBe(10_000);
  });

  it("has state directory name", () => {
    expect(DEFAULTS.STATE_DIR).toBe("processes");
  });

  it("has log directory name", () => {
    expect(DEFAULTS.LOG_DIR).toBe("logs");
  });

  it("has events file name", () => {
    expect(DEFAULTS.EVENTS_FILE).toBe("events.jsonl");
  });

  it("has home directory name", () => {
    expect(DEFAULTS.HOME_DIR).toBe(".mecha");
  });

  it("has dashboard port", () => {
    expect(DEFAULTS.DASHBOARD_PORT).toBe(7600);
  });

  it("has heartbeat interval", () => {
    expect(DEFAULTS.HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });
});
