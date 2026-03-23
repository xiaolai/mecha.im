import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, openSync, closeSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

describe("configure command", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("updates tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--tags", "research,papers"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
  });

  it("shows nothing-to-update when no flags provided", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Nothing to update");
  });

  it("rejects invalid tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--tags", "has space"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid characters"));
    expect(process.exitCode).toBe(1);

  });

  it("writes config even when existing config is corrupt", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), "not-json{{{");

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--tags", "new-tag"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["new-tag"]);
  });

  it("handles BotNotFoundError via withErrorHandler", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "unknown", "--tags", "foo"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("updates expose capabilities", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--expose", "query,read_workspace"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.expose).toEqual(["query", "read_workspace"]);
  });

  it("rejects invalid capability", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--expose", "invalid_cap"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid capability"));
    expect(process.exitCode).toBe(1);

  });

  it("updates both tags and expose together", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--tags", "dev", "--expose", "query"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["dev"]);
    expect(cfg.expose).toEqual(["query"]);
  });

  it("sets auth profile on bot", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    // Create auth profile first
    const authDir = join(mechaDir, "auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "profiles.json"), JSON.stringify({
      default: "personal",
      profiles: { personal: { type: "oauth", account: null, label: "", tags: [], expiresAt: null, createdAt: "2025-01-01T00:00:00Z" } },
    }));
    writeFileSync(join(authDir, "credentials.json"), JSON.stringify({ personal: { token: "tok" } }));

    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--auth", "personal"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.auth).toBe("personal");
  });

  it("rejects unknown auth profile", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    mkdirSync(join(mechaDir, "auth"), { recursive: true });
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--auth", "nonexistent"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  // --- addDir / removeDir tests ---

  function setupBot(dir: string, addDirs?: string[]): string {
    const botDir = join(dir, "alice");
    mkdirSync(botDir, { recursive: true });
    const config: Record<string, unknown> = { port: 7700, token: "t", workspace: "/ws" };
    if (addDirs) config.addDirs = addDirs.map((d) => realpathSync(d));
    writeFileSync(join(botDir, "config.json"), JSON.stringify(config));
    return botDir;
  }

  it("--add-dir adds a directory", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = setupBot(mechaDir);
    const extraDir = mkdtempSync(join(tmpdir(), "extra-"));
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", extraDir]);
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toContain(realpathSync(extraDir));
    rmSync(extraDir, { recursive: true, force: true });
  });

  it("--add-dir deduplicates", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = setupBot(mechaDir);
    const extraDir = mkdtempSync(join(tmpdir(), "extra-"));
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", `${extraDir},${extraDir}`]);
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toHaveLength(1);
    rmSync(extraDir, { recursive: true, force: true });
  });

  it("--add-dir appends to existing", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const existingDir = mkdtempSync(join(tmpdir(), "existing-"));
    const newDir = mkdtempSync(join(tmpdir(), "new-"));
    const botDir = setupBot(mechaDir, [existingDir]);
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", newDir]);
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toContain(realpathSync(existingDir));
    expect(cfg.addDirs).toContain(realpathSync(newDir));
    rmSync(existingDir, { recursive: true, force: true });
    rmSync(newDir, { recursive: true, force: true });
  });

  it("--add-dir rejects relative path", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", "./relative"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("absolute"));
    expect(process.exitCode).toBe(1);
  });

  it("--add-dir rejects non-existent path", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", "/nonexistent/path/xyz"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("--add-dir rejects non-directory", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const tmpFile = join(tmpdir(), `mecha-file-${Date.now()}`);
    closeSync(openSync(tmpFile, "w"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", tmpFile]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not a directory"));
    expect(process.exitCode).toBe(1);
    rmSync(tmpFile, { force: true });
  });

  it("--add-dir rejects path under mechaDir", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const subDir = join(mechaDir, "some-bot");
    mkdirSync(subDir, { recursive: true });
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", subDir]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("mecha directory"));
    expect(process.exitCode).toBe(1);
  });

  it("--remove-dir removes a directory", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const dirA = mkdtempSync(join(tmpdir(), "dir-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "dir-b-"));
    const botDir = setupBot(mechaDir, [dirA, dirB]);
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--remove-dir", dirA]);
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toEqual([realpathSync(dirB)]);
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("--remove-dir is idempotent (no error when dir not in list)", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = setupBot(mechaDir);
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--remove-dir", "/nonexistent/but/absolute"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toEqual([]);
  });

  it("--remove-dir rejects relative path", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--remove-dir", "relative"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("absolute"));
    expect(process.exitCode).toBe(1);
  });

  it("--add-dir and --remove-dir together", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const dirA = mkdtempSync(join(tmpdir(), "dir-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "dir-b-"));
    const dirC = mkdtempSync(join(tmpdir(), "dir-c-"));
    const botDir = setupBot(mechaDir, [dirA, dirB]);
    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--remove-dir", dirA, "--add-dir", dirC]);
    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.addDirs).toContain(realpathSync(dirB));
    expect(cfg.addDirs).toContain(realpathSync(dirC));
    expect(cfg.addDirs).not.toContain(realpathSync(dirA));
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
    rmSync(dirC, { recursive: true, force: true });
  });

  it("warns about restart when bot is running", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const extraDir = mkdtempSync(join(tmpdir(), "extra-"));
    setupBot(mechaDir);
    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({ mechaDir, pm: { get: vi.fn().mockReturnValue(info) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "configure", "alice", "--add-dir", extraDir]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    expect(deps.formatter.info).toHaveBeenCalledWith("Restart bot to apply directory changes");
    rmSync(extraDir, { recursive: true, force: true });
  });
});
