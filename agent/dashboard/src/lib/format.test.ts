import { describe, it, expect, vi, afterEach } from "vitest";
import { timeAgo, modelShort, formatToolLabel } from "./format";

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for < 1 minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:30Z"));
    expect(timeAgo("2026-01-01T12:00:00Z")).toBe("just now");
  });

  it("returns minutes for < 60 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:05:00Z"));
    expect(timeAgo("2026-01-01T12:00:00Z")).toBe("5m ago");
  });

  it("returns hours for < 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T15:00:00Z"));
    expect(timeAgo("2026-01-01T12:00:00Z")).toBe("3h ago");
  });

  it("returns 'yesterday' for 1 day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    expect(timeAgo("2026-01-01T12:00:00Z")).toBe("yesterday");
  });

  it("returns days for > 1 day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-04T12:00:00Z"));
    expect(timeAgo("2026-01-01T12:00:00Z")).toBe("3d ago");
  });

  it("returns 'unknown' for empty string", () => {
    expect(timeAgo("")).toBe("unknown");
  });

  it("returns 'unknown' for invalid date", () => {
    expect(timeAgo("not-a-date")).toBe("unknown");
  });
});

describe("modelShort", () => {
  it("shortens opus model", () => {
    expect(modelShort("claude-opus-4-6")).toBe("opus");
  });

  it("shortens sonnet model", () => {
    expect(modelShort("claude-sonnet-4-6")).toBe("sonnet");
  });

  it("shortens haiku model", () => {
    expect(modelShort("claude-haiku-4-5-20251001")).toBe("haiku");
  });

  it("falls back to last segment for unknown model", () => {
    expect(modelShort("gpt-4o-mini")).toBe("mini");
  });

  it("returns model as-is if no dashes", () => {
    expect(modelShort("custom")).toBe("custom");
  });

  it("returns 'unknown' for empty string", () => {
    expect(modelShort("")).toBe("unknown");
  });
});

describe("formatToolLabel", () => {
  it("returns empty string for null input", () => {
    expect(formatToolLabel("Read", null)).toBe("");
  });

  it("returns empty string for non-object input", () => {
    expect(formatToolLabel("Read", "string")).toBe("");
  });

  it("extracts file_path for Read", () => {
    expect(formatToolLabel("Read", { file_path: "/src/app.ts" })).toBe("/src/app.ts");
  });

  it("extracts file_path for Edit", () => {
    expect(formatToolLabel("Edit", { file_path: "/src/lib.ts", old_string: "a" })).toBe("/src/lib.ts");
  });

  it("extracts file_path for Write", () => {
    expect(formatToolLabel("Write", { file_path: "/new.ts", content: "x" })).toBe("/new.ts");
  });

  it("extracts and truncates command for Bash", () => {
    const long = "a".repeat(100);
    expect(formatToolLabel("Bash", { command: long })).toBe("a".repeat(80));
  });

  it("extracts pattern for Grep", () => {
    expect(formatToolLabel("Grep", { pattern: "TODO" })).toBe("TODO");
  });

  it("extracts pattern for Glob", () => {
    expect(formatToolLabel("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("extracts query for WebSearch", () => {
    expect(formatToolLabel("WebSearch", { query: "vitest setup" })).toBe("vitest setup");
  });

  it("falls back to first two keys for unknown tool", () => {
    expect(formatToolLabel("CustomTool", { alpha: 1, beta: 2, gamma: 3 })).toBe("alpha, beta");
  });

  it("returns empty string when file_path is missing", () => {
    expect(formatToolLabel("Read", { other: "value" })).toBe("");
  });
});
