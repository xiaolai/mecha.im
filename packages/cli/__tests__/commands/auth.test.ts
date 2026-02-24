import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import type { CommandDeps } from "../../src/types.js";
import type { ProcessManager } from "@mecha/process";

function makeDeps(mechaDir: string): CommandDeps {
  return {
    formatter: {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      json: vi.fn(),
      table: vi.fn(),
    },
    processManager: {} as ProcessManager,
    mechaDir,
  };
}

describe("auth commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function setup(): { mechaDir: string; deps: CommandDeps } {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-auth-"));
    const mechaDir = tempDir;
    mkdirSync(join(mechaDir, "auth"), { recursive: true });
    const deps = makeDeps(mechaDir);
    return { mechaDir, deps };
  }

  it("adds an auth profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "personal", "--oauth", "--token", "tok-123"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Added"));
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("default"));
  });

  it("adds api-key profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "work", "--api-key", "--token", "sk-abc"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("api-key"));
  });

  it("lists profiles (empty)", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No auth profiles");
  });

  it("adds profile without --token flag", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "empty-tok", "--oauth"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Added"));
  });

  it("lists profiles with default and non-default", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "a", "--oauth", "--token", "tok"]);
    await program.parseAsync(["node", "mecha", "auth", "add", "b", "--api-key", "--token", "sk"]);
    await program.parseAsync(["node", "mecha", "auth", "ls"]);
    const rows = vi.mocked(deps.formatter.table).mock.calls[0]![1] as string[][];
    const defaults = rows.map((r) => r[2]);
    expect(defaults).toContain("✓");
    expect(defaults).toContain("");
  });

  it("sets default profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "a", "--oauth", "--token", "tok"]);
    await program.parseAsync(["node", "mecha", "auth", "add", "b", "--api-key", "--token", "sk"]);
    await program.parseAsync(["node", "mecha", "auth", "default", "b"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Default"));
  });

  it("removes a profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "rm-me", "--oauth", "--token", "tok"]);
    await program.parseAsync(["node", "mecha", "auth", "rm", "rm-me"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("tags a profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "tagged", "--oauth", "--token", "tok"]);
    await program.parseAsync(["node", "mecha", "auth", "tag", "tagged", "research", "coding"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Tags"));
  });

  it("switches profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "a", "--oauth", "--token", "t1"]);
    await program.parseAsync(["node", "mecha", "auth", "add", "b", "--api-key", "--token", "t2"]);
    await program.parseAsync(["node", "mecha", "auth", "switch", "b"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Switched"));
  });

  it("tests a profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "valid", "--oauth", "--token", "tok-123"]);
    await program.parseAsync(["node", "mecha", "auth", "test", "valid"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("valid"));
  });

  it("reports invalid profile", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "empty", "--oauth", "--token", ""]);
    await program.parseAsync(["node", "mecha", "auth", "test", "empty"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid"));
  });

  it("renews a token", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "renew", "--oauth", "--token", "old"]);
    await program.parseAsync(["node", "mecha", "auth", "renew", "renew", "new-tok"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("renewed"));
  });
});
