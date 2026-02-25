import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("auth commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  function setup(): { mechaDir: string; deps: CommandDeps } {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-auth-"));
    const mechaDir = tempDir;
    mkdirSync(join(mechaDir, "auth"), { recursive: true });
    const deps = makeDeps({ mechaDir });
    return { mechaDir, deps };
  }

  it("rejects both --oauth and --api-key", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "bad", "--oauth", "--api-key", "--token", "tok"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Cannot use both"));
    expect(process.exitCode).toBe(1);

  });

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

  it("rejects profile without --token flag", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "add", "empty-tok", "--oauth"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Token is required"));
    expect(process.exitCode).toBe(1);

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

  it("rejects empty token via --token ''", async () => {
    const { deps } = setup();
    const program = createProgram(deps);
    program.exitOverride();

    // Empty string token is rejected at CLI level
    await program.parseAsync(["node", "mecha", "auth", "add", "empty", "--oauth", "--token", ""]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Token is required"));
    expect(process.exitCode).toBe(1);

  });

  it("reports invalid profile via auth test", async () => {
    const { mechaDir, deps } = setup();
    // Bypass CLI to create profile with empty token directly
    const { mechaAuthAdd } = await import("@mecha/service");
    mechaAuthAdd(mechaDir, "empty", "oauth", "");
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "auth", "test", "empty"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid"));
    expect(process.exitCode).toBe(1);

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
