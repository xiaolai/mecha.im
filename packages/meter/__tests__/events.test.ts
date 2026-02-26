import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEvent, readEventsForDate, listEventDates, utcDate, eventsDir } from "../src/events.js";
import type { MeterEvent } from "../src/types.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST",
    ts: "2026-02-26T12:00:00.000Z",
    casa: "researcher",
    authProfile: "default",
    workspace: "/home/user/project",
    tags: ["research"],
    model: "claude-sonnet-4-6",
    stream: true,
    status: 200,
    modelActual: "claude-sonnet-4-6",
    latencyMs: 500,
    ttftMs: 50,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 80,
    costUsd: 0.001,
    ...overrides,
  };
}

describe("events", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("utcDate", () => {
    it("extracts date from ISO timestamp", () => {
      expect(utcDate("2026-02-26T12:00:00.000Z")).toBe("2026-02-26");
    });
  });

  describe("eventsDir", () => {
    it("returns events subdirectory", () => {
      expect(eventsDir("/path/to/meter")).toBe("/path/to/meter/events");
    });
  });

  describe("appendEvent", () => {
    it("creates events directory and JSONL file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      const event = makeEvent();
      appendEvent(tempDir, event);

      const file = join(tempDir, "events", "2026-02-26.jsonl");
      expect(existsSync(file)).toBe(true);

      const raw = readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe("01TEST");
    });

    it("appends multiple events to same file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      appendEvent(tempDir, makeEvent({ id: "A" }));
      appendEvent(tempDir, makeEvent({ id: "B" }));

      const file = join(tempDir, "events", "2026-02-26.jsonl");
      const lines = readFileSync(file, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).id).toBe("A");
      expect(JSON.parse(lines[1]!).id).toBe("B");
    });

    it("writes to different files for different dates", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      appendEvent(tempDir, makeEvent({ ts: "2026-02-26T12:00:00Z" }));
      appendEvent(tempDir, makeEvent({ ts: "2026-02-27T12:00:00Z" }));

      expect(existsSync(join(tempDir, "events", "2026-02-26.jsonl"))).toBe(true);
      expect(existsSync(join(tempDir, "events", "2026-02-27.jsonl"))).toBe(true);
    });
  });

  describe("validateDate (via appendEvent / readEventsForDate)", () => {
    it("rejects path-traversal date in appendEvent", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      const event = makeEvent({ ts: "../../etc/passwd" });
      expect(() => appendEvent(tempDir, event)).toThrow("Invalid date format");
    });

    it("rejects path-traversal date in readEventsForDate", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      expect(() => readEventsForDate(tempDir, "../etc/passwd")).toThrow("Invalid date format");
    });
  });

  describe("readEventsForDate", () => {
    it("returns empty array for non-existent date", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      expect(readEventsForDate(tempDir, "2026-01-01")).toEqual([]);
    });

    it("reads events for a date", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      appendEvent(tempDir, makeEvent({ id: "X", casa: "coder" }));
      appendEvent(tempDir, makeEvent({ id: "Y", casa: "researcher" }));

      const events = readEventsForDate(tempDir, "2026-02-26");
      expect(events).toHaveLength(2);
      expect(events[0]!.id).toBe("X");
      expect(events[1]!.id).toBe("Y");
    });
  });

  describe("listEventDates", () => {
    it("returns empty for non-existent directory", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      expect(listEventDates(tempDir)).toEqual([]);
    });

    it("lists dates in sorted order", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-events-"));
      appendEvent(tempDir, makeEvent({ ts: "2026-02-27T00:00:00Z" }));
      appendEvent(tempDir, makeEvent({ ts: "2026-02-25T00:00:00Z" }));
      appendEvent(tempDir, makeEvent({ ts: "2026-02-26T00:00:00Z" }));

      const dates = listEventDates(tempDir);
      expect(dates).toEqual(["2026-02-25", "2026-02-26", "2026-02-27"]);
    });
  });
});
