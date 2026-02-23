import { describe, it, expect } from "vitest";
import { DEFAULTS, MOUNT_PATHS, LABELS, SECURITY } from "../src/constants.js";

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

describe("MOUNT_PATHS (deprecated)", () => {
  it("has workspace mount", () => {
    expect(MOUNT_PATHS.WORKSPACE).toBe("/home/mecha");
  });

  it("has state mount", () => {
    expect(MOUNT_PATHS.STATE).toBe("/var/lib/mecha");
  });

  it("has tmp mount", () => {
    expect(MOUNT_PATHS.TMP).toBe("/tmp");
  });
});

describe("LABELS (deprecated)", () => {
  it("has mecha marker label", () => {
    expect(LABELS.IS_MECHA).toBe("mecha");
  });

  it("has ID label key", () => {
    expect(LABELS.MECHA_ID).toBe("mecha.id");
  });

  it("has path label key", () => {
    expect(LABELS.MECHA_PATH).toBe("mecha.path");
  });
});

describe("SECURITY (deprecated)", () => {
  it("runs as non-root UID", () => {
    expect(SECURITY.UID).toBe(1000);
  });

  it("drops all capabilities", () => {
    expect(SECURITY.CAP_DROP).toContain("ALL");
  });

  it("prevents privilege escalation", () => {
    expect(SECURITY.SECURITY_OPT).toContain("no-new-privileges");
  });
});
