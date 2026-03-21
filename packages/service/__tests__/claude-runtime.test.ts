import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs and child_process before importing
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(), accessSync: vi.fn() };
});
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { existsSync, accessSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const mockExistsSync = vi.mocked(existsSync);
const mockAccessSync = vi.mocked(accessSync);
const mockExecFile = vi.mocked(execFile);

// Import after mocks are set up
let resolveClaudeRuntime: typeof import("../src/claude-runtime.js").resolveClaudeRuntime;
let invalidateClaudeRuntimeCache: typeof import("../src/claude-runtime.js").invalidateClaudeRuntimeCache;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  const mod = await import("../src/claude-runtime.js");
  resolveClaudeRuntime = mod.resolveClaudeRuntime;
  invalidateClaudeRuntimeCache = mod.invalidateClaudeRuntimeCache;
});

function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    (cb as (err: null, stdout: string) => void)(null, stdout);
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileFailure() {
  mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    (cb as (err: Error) => void)(new Error("not found"));
    return {} as ReturnType<typeof execFile>;
  });
}

describe("resolveClaudeRuntime", () => {
  it("finds first executable candidate", async () => {
    const expected = join(homedir(), ".local", "bin", "claude");
    mockExistsSync.mockImplementation((p) => p === expected);
    mockAccessSync.mockImplementation(() => undefined);
    mockExecFileSuccess("2.1.70 (Claude Code)\n");

    const info = await resolveClaudeRuntime();
    expect(info.binPath).toBe(expected);
    expect(info.version).toBe("2.1.70");
    expect(info.resolvedFrom).toBe("local-bin");
  });

  it("skips non-executable candidates", async () => {
    const first = join(homedir(), ".local", "bin", "claude");
    const second = join(homedir(), ".claude", "local", "bin", "claude");
    mockExistsSync.mockImplementation((p) => p === first || p === second);
    mockAccessSync.mockImplementation((p) => {
      if (p === first) throw new Error("EACCES");
    });
    mockExecFileSuccess("3.0.0 (Claude Code)\n");

    const info = await resolveClaudeRuntime();
    expect(info.binPath).toBe(second);
    expect(info.resolvedFrom).toBe("claude-local");
  });

  it("falls back to PATH when no candidate exists", async () => {
    mockExistsSync.mockReturnValue(false);
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      callCount++;
      if (callCount === 1) {
        // which claude
        (cb as (err: null, stdout: string) => void)(null, "/opt/bin/claude\n");
      } else {
        // --version
        (cb as (err: null, stdout: string) => void)(null, "2.0.0\n");
      }
      return {} as ReturnType<typeof execFile>;
    });

    const info = await resolveClaudeRuntime();
    expect(info.binPath).toBe("/opt/bin/claude");
    expect(info.version).toBe("2.0.0");
    expect(info.resolvedFrom).toBe("path");
  });

  it("returns not-found when nothing available", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileFailure();

    const info = await resolveClaudeRuntime();
    expect(info.binPath).toBeNull();
    expect(info.version).toBeNull();
    expect(info.resolvedFrom).toBe("not-found");
  });

  it("returns null version when --version fails", async () => {
    const expected = join(homedir(), ".local", "bin", "claude");
    mockExistsSync.mockImplementation((p) => p === expected);
    mockAccessSync.mockImplementation(() => undefined);
    mockExecFileFailure();

    const info = await resolveClaudeRuntime();
    expect(info.binPath).toBe(expected);
    expect(info.version).toBeNull();
  });

  it("caches results across calls", async () => {
    const expected = join(homedir(), ".local", "bin", "claude");
    mockExistsSync.mockImplementation((p) => p === expected);
    mockAccessSync.mockImplementation(() => undefined);
    mockExecFileSuccess("2.1.70\n");

    const info1 = await resolveClaudeRuntime();
    const info2 = await resolveClaudeRuntime();
    expect(info1).toBe(info2);
    // execFile called only once (for version), not twice
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("invalidateClaudeRuntimeCache forces re-resolve", async () => {
    const expected = join(homedir(), ".local", "bin", "claude");
    mockExistsSync.mockImplementation((p) => p === expected);
    mockAccessSync.mockImplementation(() => undefined);
    mockExecFileSuccess("2.1.70\n");

    await resolveClaudeRuntime();
    invalidateClaudeRuntimeCache();
    await resolveClaudeRuntime();
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});
