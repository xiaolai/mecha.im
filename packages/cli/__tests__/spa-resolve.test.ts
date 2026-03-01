import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We can't easily test resolveSpaDir since it uses import.meta.url
// to resolve relative to the source file. Instead we test the exported
// function behavior with mocked existsSync.

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

describe("resolveSpaDir", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no SPA dist found", async () => {
    const { resolveSpaDir } = await import("../src/spa-resolve.js");
    const result = resolveSpaDir();
    expect(result).toBeUndefined();
  });

  it("returns monorepo path when index.html exists there", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      return typeof p === "string" && p.includes("spa") && p.endsWith("index.html");
    });

    const { resolveSpaDir } = await import("../src/spa-resolve.js");
    const result = resolveSpaDir();
    expect(result).toBeDefined();
    expect(result).toContain("spa");
  });
});
