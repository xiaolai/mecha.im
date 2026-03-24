import { describe, it, expect } from "vitest";
import {
  parseInterval,
  cronMatches,
  nextCronMs,
  isCronExpression,
  parseScheduleExpression,
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

describe("cron expressions", () => {
  describe("cronMatches", () => {
    it("matches every 6 hours", () => {
      const cron = "0 */6 * * *";
      expect(cronMatches(cron, new Date("2026-03-24T00:00:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-03-24T06:00:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-03-24T12:00:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-03-24T03:00:00"))).toBe(false);
    });

    it("matches Monday 9am", () => {
      const cron = "0 9 * * 1";
      // 2026-03-23 is a Monday
      expect(cronMatches(cron, new Date("2026-03-23T09:00:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-03-24T09:00:00"))).toBe(false); // Tuesday
    });

    it("matches specific minute and hour", () => {
      expect(cronMatches("30 14 * * *", new Date("2026-01-01T14:30:00"))).toBe(true);
      expect(cronMatches("30 14 * * *", new Date("2026-01-01T14:31:00"))).toBe(false);
    });

    it("handles comma-separated values", () => {
      expect(cronMatches("0 9,17 * * *", new Date("2026-01-01T09:00:00"))).toBe(true);
      expect(cronMatches("0 9,17 * * *", new Date("2026-01-01T17:00:00"))).toBe(true);
      expect(cronMatches("0 9,17 * * *", new Date("2026-01-01T12:00:00"))).toBe(false);
    });

    it("handles step values on minute field", () => {
      const cron = "*/15 * * * *";
      expect(cronMatches(cron, new Date("2026-01-01T00:00:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-01-01T00:15:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-01-01T00:30:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-01-01T00:45:00"))).toBe(true);
      expect(cronMatches(cron, new Date("2026-01-01T00:07:00"))).toBe(false);
    });

    it("handles specific day-of-month", () => {
      expect(cronMatches("0 0 1 * *", new Date("2026-01-01T00:00:00"))).toBe(true);
      expect(cronMatches("0 0 1 * *", new Date("2026-01-02T00:00:00"))).toBe(false);
    });

    it("handles specific month", () => {
      expect(cronMatches("0 0 1 6 *", new Date("2026-06-01T00:00:00"))).toBe(true);
      expect(cronMatches("0 0 1 6 *", new Date("2026-07-01T00:00:00"))).toBe(false);
    });

    it("returns false for invalid expression", () => {
      expect(cronMatches("invalid", new Date())).toBe(false);
      expect(cronMatches("", new Date())).toBe(false);
      expect(cronMatches("5m", new Date())).toBe(false);
    });
  });

  describe("nextCronMs", () => {
    it("calculates next run for every-6-hour schedule", () => {
      const from = new Date("2026-03-24T01:30:00");
      const ms = nextCronMs("0 */6 * * *", from);
      expect(ms).toBeDefined();
      // Next match is 06:00, which is 4h30m away
      expect(ms!).toBeGreaterThan(0);
      expect(ms!).toBeLessThan(6 * 3600 * 1000);
    });

    it("calculates next run from just before a match", () => {
      // From 08:59, next */6 match is 12:00 (3h1m away)
      const from = new Date("2026-03-24T08:59:00");
      const ms = nextCronMs("0 */6 * * *", from);
      expect(ms).toBeDefined();
      // Next match at 12:00 = 3 hours and 1 minute
      const expectedMs = (3 * 60 + 1) * 60_000;
      expect(ms).toBe(expectedMs);
    });

    it("skips current minute", () => {
      // Even if we're on the exact cron minute, nextCronMs starts from next minute
      const from = new Date("2026-03-24T06:00:00");
      const ms = nextCronMs("0 */6 * * *", from);
      expect(ms).toBeDefined();
      // Next match at 12:00 = 6 hours
      expect(ms!).toBe(6 * 3600 * 1000);
    });

    it("returns undefined for invalid cron", () => {
      expect(nextCronMs("invalid")).toBeUndefined();
      expect(nextCronMs("5m")).toBeUndefined();
    });
  });

  describe("isCronExpression", () => {
    it("identifies valid cron", () => {
      expect(isCronExpression("0 */6 * * *")).toBe(true);
      expect(isCronExpression("30 9 * * 1")).toBe(true);
      expect(isCronExpression("*/5 * * * *")).toBe(true);
      expect(isCronExpression("0 0 1,15 * *")).toBe(true);
    });

    it("rejects non-cron", () => {
      expect(isCronExpression("5m")).toBe(false);
      expect(isCronExpression("hello")).toBe(false);
      expect(isCronExpression("30s")).toBe(false);
      expect(isCronExpression("")).toBe(false);
    });

    it("handles leading/trailing whitespace", () => {
      expect(isCronExpression("  0 */6 * * *  ")).toBe(true);
    });
  });

  describe("parseScheduleExpression", () => {
    it("parses interval strings", () => {
      const result = parseScheduleExpression("30s");
      expect(result).toBeDefined();
      expect(result!.type).toBe("interval");
      expect(result!.nextMs()).toBe(30_000);
    });

    it("parses cron expressions", () => {
      const result = parseScheduleExpression("0 */6 * * *");
      expect(result).toBeDefined();
      expect(result!.type).toBe("cron");
      const ms = result!.nextMs();
      expect(ms).toBeDefined();
      expect(ms!).toBeGreaterThan(0);
    });

    it("parses cron with a specific from date", () => {
      const result = parseScheduleExpression("0 9 * * *");
      expect(result).toBeDefined();
      expect(result!.type).toBe("cron");
      const from = new Date("2026-03-24T08:00:00");
      const ms = result!.nextMs(from);
      expect(ms).toBeDefined();
      // Next 09:00 is 1 hour away
      expect(ms!).toBe(60 * 60_000);
    });

    it("prefers interval over cron for ambiguous input", () => {
      // "1h" is a valid interval and would not match CRON_RE
      const result = parseScheduleExpression("1h");
      expect(result).toBeDefined();
      expect(result!.type).toBe("interval");
    });

    it("returns undefined for invalid input", () => {
      expect(parseScheduleExpression("invalid")).toBeUndefined();
      expect(parseScheduleExpression("")).toBeUndefined();
    });
  });
});
