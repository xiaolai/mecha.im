import { describe, it, expect } from "vitest";
import {
  parseInterval,
  ScheduleEntrySchema,
  ScheduleConfigSchema,
  ScheduleAddInput,
  SCHEDULE_DEFAULTS,
} from "../src/schedule.js";

describe("parseInterval", () => {
  it("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("10s")).toBe(10_000);
  });

  it("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300_000);
    expect(parseInterval("1m")).toBe(60_000);
  });

  it("parses hours", () => {
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("24h")).toBe(86_400_000);
  });

  it("rejects invalid formats", () => {
    expect(parseInterval("")).toBeUndefined();
    expect(parseInterval("abc")).toBeUndefined();
    expect(parseInterval("5")).toBeUndefined();
    expect(parseInterval("5d")).toBeUndefined();
    expect(parseInterval("-1m")).toBeUndefined();
    expect(parseInterval("0s")).toBeUndefined();
  });

  it("rejects intervals below minimum (10s)", () => {
    expect(parseInterval("5s")).toBeUndefined();
    expect(parseInterval("9s")).toBeUndefined();
  });

  it("rejects intervals above maximum (24h)", () => {
    expect(parseInterval("25h")).toBeUndefined();
  });
});

describe("ScheduleEntrySchema", () => {
  it("validates a valid entry", () => {
    const result = ScheduleEntrySchema.parse({
      id: "inbox-check",
      trigger: { type: "interval", every: "5m", intervalMs: 300_000 },
      prompt: "Check inbox",
    });
    expect(result.id).toBe("inbox-check");
    expect(result.trigger.intervalMs).toBe(300_000);
    expect(result.paused).toBeUndefined();
  });

  it("allows paused field", () => {
    const result = ScheduleEntrySchema.parse({
      id: "test",
      trigger: { type: "interval", every: "1m", intervalMs: 60_000 },
      prompt: "hello",
      paused: true,
    });
    expect(result.paused).toBe(true);
  });

  it("rejects invalid id (uppercase)", () => {
    expect(() => ScheduleEntrySchema.parse({
      id: "BAD_ID",
      trigger: { type: "interval", every: "1m", intervalMs: 60_000 },
      prompt: "hello",
    })).toThrow();
  });

  it("rejects empty prompt", () => {
    expect(() => ScheduleEntrySchema.parse({
      id: "test",
      trigger: { type: "interval", every: "1m", intervalMs: 60_000 },
      prompt: "",
    })).toThrow();
  });
});

describe("ScheduleConfigSchema", () => {
  it("validates with defaults", () => {
    const result = ScheduleConfigSchema.parse({ schedules: [] });
    expect(result.schedules).toEqual([]);
    expect(result.maxRunsPerDay).toBeUndefined();
  });

  it("validates with budget options", () => {
    const result = ScheduleConfigSchema.parse({
      schedules: [],
      maxRunsPerDay: 10,
      maxConcurrent: 1,
    });
    expect(result.maxRunsPerDay).toBe(10);
    expect(result.maxConcurrent).toBe(1);
  });

  it("rejects maxConcurrent > 1", () => {
    expect(() => ScheduleConfigSchema.parse({
      schedules: [],
      maxConcurrent: 2,
    })).toThrow();
  });
});

describe("ScheduleAddInput", () => {
  it("validates add input", () => {
    const result = ScheduleAddInput.parse({
      id: "daily-check",
      every: "5m",
      prompt: "Check things",
    });
    expect(result.id).toBe("daily-check");
    expect(result.every).toBe("5m");
  });

  it("rejects missing fields", () => {
    expect(() => ScheduleAddInput.parse({ id: "test" })).toThrow();
    expect(() => ScheduleAddInput.parse({ every: "5m" })).toThrow();
  });
});

describe("SCHEDULE_DEFAULTS", () => {
  it("has expected values", () => {
    expect(SCHEDULE_DEFAULTS.MAX_RUNS_PER_DAY).toBe(50);
    expect(SCHEDULE_DEFAULTS.MAX_CONCURRENT).toBe(1);
    expect(SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS).toBe(5);
  });
});
