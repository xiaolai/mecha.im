import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { EventEmitter } from "node:events";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockSpawn = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("@mecha/core", () => ({
  DEFAULTS: { DASHBOARD_PORT: 7600 },
}));

import { registerDashboardCommand } from "../../src/commands/dashboard.js";

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

function createMockChild(): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter();
  (child as any).unref = vi.fn();
  return child as any;
}

describe("mecha dashboard", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the dashboard command", () => {
    const program = new Command();
    registerDashboardCommand(program, deps);
    const cmd = program.commands.find((c) => c.name() === "dashboard");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe("Launch the Mecha web dashboard");
  });

  it("skips build when .next exists", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "npx", ["next", "start", "-p", "7600", "-H", "127.0.0.1"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("Starting dashboard"));
  });

  it("triggers build when .next is missing", async () => {
    mockExistsSync.mockReturnValue(false);
    const buildChild = createMockChild();
    const serverChild = createMockChild();
    mockSpawn.mockReturnValueOnce(buildChild).mockReturnValueOnce(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    expect(formatter.info).toHaveBeenCalledWith("Dashboard not built. Building now...");
    expect(mockSpawn).toHaveBeenCalledWith(
      "npx", ["next", "build"],
      expect.objectContaining({ stdio: "inherit" }),
    );

    buildChild.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenLastCalledWith(
      "npx", ["next", "start", "-p", "7600", "-H", "127.0.0.1"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("handles build failure gracefully", async () => {
    mockExistsSync.mockReturnValue(false);
    const buildChild = createMockChild();
    mockSpawn.mockReturnValue(buildChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    buildChild.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(formatter.error).toHaveBeenCalledWith("Build failed with code 1");
    expect(process.exitCode).toBe(1);
  });

  it("handles build error event gracefully", async () => {
    mockExistsSync.mockReturnValue(false);
    const buildChild = createMockChild();
    mockSpawn.mockReturnValue(buildChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    buildChild.emit("error", new Error("spawn ENOENT"));
    await vi.advanceTimersByTimeAsync(0);
    expect(formatter.error).toHaveBeenCalledWith("spawn ENOENT");
    expect(process.exitCode).toBe(1);
  });

  it("forwards --port to next start", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--port", "9000", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSpawn).toHaveBeenCalledWith(
      "npx", ["next", "start", "-p", "9000", "-H", "127.0.0.1"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("opens browser by default after delay", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    const browserChild = createMockChild();
    mockSpawn.mockReturnValueOnce(serverChild).mockReturnValueOnce(browserChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("uses cmd on win32 platform", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    const browserChild = createMockChild();
    mockSpawn.mockReturnValueOnce(serverChild).mockReturnValueOnce(browserChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenLastCalledWith(
      "cmd", ["/c", "start", "", "http://localhost:7600"],
      expect.objectContaining({ stdio: "ignore", detached: true }),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("uses xdg-open on linux platform", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    const browserChild = createMockChild();
    mockSpawn.mockReturnValueOnce(serverChild).mockReturnValueOnce(browserChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenLastCalledWith(
      "xdg-open", ["http://localhost:7600"],
      expect.objectContaining({ stdio: "ignore", detached: true }),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("skips browser open with --no-open", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(2500);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("sets exitCode on server child error", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    serverChild.emit("error", new Error("ENOENT"));
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode on non-zero server exit", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    serverChild.emit("exit", 2);
    expect(process.exitCode).toBe(2);
  });

  it("does not set exitCode on zero or null exit code", async () => {
    mockExistsSync.mockReturnValue(true);
    const serverChild = createMockChild();
    mockSpawn.mockReturnValue(serverChild);

    const program = new Command();
    registerDashboardCommand(program, deps);
    program.parseAsync(["dashboard", "--no-open"], { from: "user" });
    await vi.advanceTimersByTimeAsync(0);

    serverChild.emit("exit", 0);
    expect(process.exitCode).toBeUndefined();

    serverChild.emit("exit", null);
    expect(process.exitCode).toBeUndefined();
  });
});
