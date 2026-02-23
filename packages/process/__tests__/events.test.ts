import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../src/events.js";
import type { ProcessEvent } from "../src/types.js";

function makeEvent(overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return {
    type: "start",
    mechaId: "mx-test-abc123",
    pid: 12345,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("EventLog", () => {
  let dir: string;
  let filePath: string;
  let log: EventLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mecha-events-test-"));
    filePath = join(dir, "events.jsonl");
    log = new EventLog(filePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file if it does not exist", () => {
    const newPath = join(dir, "nested", "events.jsonl");
    const newLog = new EventLog(newPath);
    const content = readFileSync(newPath, "utf-8");
    expect(content).toBe("");
  });

  it("emits and reads events", () => {
    const event = makeEvent();
    log.emit(event);
    const events = log.readAll();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("start");
    expect(events[0].mechaId).toBe("mx-test-abc123");
  });

  it("appends multiple events", () => {
    log.emit(makeEvent({ type: "start" }));
    log.emit(makeEvent({ type: "stop" }));
    log.emit(makeEvent({ type: "exit", exitCode: 0 }));
    const events = log.readAll();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["start", "stop", "exit"]);
  });

  it("returns empty array for empty file", () => {
    expect(log.readAll()).toEqual([]);
  });

  it("returns empty array when file is missing", () => {
    rmSync(filePath);
    expect(log.readAll()).toEqual([]);
  });

  it("truncates events when over 1000", () => {
    // Write 1005 events
    for (let i = 0; i < 1005; i++) {
      log.emit(makeEvent({ timestamp: i }));
    }
    const events = log.readAll();
    expect(events.length).toBeLessThanOrEqual(1000);
    // The last event should be the most recent
    expect(events[events.length - 1].timestamp).toBe(1004);
  });

  it("does not overwrite existing file on construction", () => {
    // Write some content to the file first
    writeFileSync(filePath, '{"type":"start","mechaId":"x","timestamp":1}\n');
    // Create a new EventLog pointing to same file — should not overwrite
    const log2 = new EventLog(filePath);
    const events = log2.readAll();
    expect(events).toHaveLength(1);
  });

  it("watch returns unsubscribe function", () => {
    const handler = () => {};
    const unsubscribe = log.watch(handler);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe(); // Should not throw
  });
});
