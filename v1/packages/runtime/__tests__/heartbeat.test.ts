import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { startHeartbeat } from "../src/supervisor/heartbeat.js";
import { createDatabase, runMigrations } from "../src/db/sqlite.js";
import type Database from "better-sqlite3";
import type { MechaId } from "@mecha/core";

const TEST_ID = "mx-test-abc123" as MechaId;

describe("Heartbeat", () => {
  let db: Database.Database;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createDatabase(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    if (stop) stop();
    if (db) db.close();
    vi.useRealTimers();
  });

  it("writes an initial heartbeat immediately", () => {
    stop = startHeartbeat(db, TEST_ID, 5000);

    const rows = db.prepare("SELECT * FROM heartbeats").all() as Array<{
      mecha_id: string;
      status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].mecha_id).toBe(TEST_ID);
    expect(rows[0].status).toBe("running");
  });

  it("writes heartbeats on each interval tick", () => {
    stop = startHeartbeat(db, TEST_ID, 1000);

    // 1 initial + 3 interval ticks
    vi.advanceTimersByTime(3000);

    const rows = db.prepare("SELECT * FROM heartbeats").all();
    expect(rows).toHaveLength(4); // 1 initial + 3 ticks
  });

  it("catches and logs error when stmt.run throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Start heartbeat normally to get the first write
    stop = startHeartbeat(db, TEST_ID, 5000);

    // Now drop the table to cause future writes to fail
    db.exec("DROP TABLE heartbeats");

    // Advance timer to trigger a write that will fail
    vi.advanceTimersByTime(5000);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Heartbeat write failed:",
      expect.stringContaining("heartbeats"),
    );
    consoleSpy.mockRestore();
  });

  it("stops writing heartbeats after stopHeartbeat is called", () => {
    stop = startHeartbeat(db, TEST_ID, 1000);

    vi.advanceTimersByTime(2000); // 1 initial + 2 ticks = 3 rows
    stop();
    stop = undefined;

    vi.advanceTimersByTime(3000); // no more writes

    const rows = db.prepare("SELECT * FROM heartbeats").all();
    expect(rows).toHaveLength(3);
  });
});
