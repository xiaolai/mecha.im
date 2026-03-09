import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "start-test-")); });
afterEach(() => {
  process.exitCode = undefined as unknown as number;
  rmSync(dir, { recursive: true, force: true });
});

const mockServer = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mecha/agent", () => ({
  createAgentServer: vi.fn().mockReturnValue(mockServer),
}));

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    readNodeName: vi.fn().mockReturnValue("test-node"),
  };
});

vi.mock("@mecha/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/process")>();
  return {
    ...actual,
    createBunPtySpawn: vi.fn().mockReturnValue(vi.fn()),
  };
});

vi.mock("../../src/spa-resolve.js", () => ({
  resolveSpaDir: vi.fn().mockResolvedValue("/fake/spa/dist"),
}));

vi.mock("../../src/totp-display.js", () => ({
  displayTotpSetup: vi.fn().mockResolvedValue(undefined),
}));

describe("start command", () => {
  it("starts with TOTP by default (auto-generates secret)", async () => {
    const hooks: Array<() => Promise<void>> = [];
    const deps = makeDeps({ mechaDir: dir, registerShutdownHook: (fn) => hooks.push(fn) });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Mecha started"));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("TOTP"));
  });

  it("warns when SPA not found", async () => {
    const { resolveSpaDir } = await import("../../src/spa-resolve.js");
    vi.mocked(resolveSpaDir).mockResolvedValueOnce(undefined);

    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Agent server started"));
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("SPA not found"));
  });

  it("rejects invalid agent port", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    expect(process.exitCode).toBe(1);
  });

  it("forwards port option to server", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "7700"]);
    expect(mockServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 7700 }));
  });

  it("registers --daemon option", () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    const startCmd = program.commands.find((c) => c.name() === "start");
    expect(startCmd).toBeDefined();
    const daemonOpt = startCmd!.options.find((o) => o.long === "--daemon");
    expect(daemonOpt).toBeDefined();
    expect(daemonOpt!.short).toBe("-d");
    expect(daemonOpt!.defaultValue).toBe(false);
  });

  it("writes daemon.pid after server listen", async () => {
    const { existsSync, readFileSync: readFs } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    const pidFile = joinPath(dir, "daemon.pid");
    expect(existsSync(pidFile)).toBe(true);
    const pid = parseInt(readFs(pidFile, "utf-8").trim(), 10);
    expect(pid).toBe(process.pid);
  });

  it("writes agent.json after starting", async () => {
    const hooks: Array<() => Promise<void>> = [];
    const deps = makeDeps({ mechaDir: dir, registerShutdownHook: (fn) => hooks.push(fn) });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);

    const agentJson = JSON.parse(readFileSync(join(dir, "agent.json"), "utf8"));
    expect(agentJson.port).toBe(7660);
    expect(agentJson.pid).toBe(process.pid);
    expect(agentJson.startedAt).toBeDefined();
  });
});
