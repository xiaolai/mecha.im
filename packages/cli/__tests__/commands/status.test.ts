import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "status-test-")); });
afterEach(() => {
  process.exitCode = undefined as unknown as number;
  rmSync(dir, { recursive: true, force: true });
});

describe("mecha status", () => {
  it("is registered as a command", () => {
    const program = createProgram(makeDeps());
    const cmd = program.commands.find(c => c.name() === "status");
    expect(cmd).toBeDefined();
  });

  it("shows daemon not running when no PID file", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "--port", "19999"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Daemon not running");
  });

  it("shows stale PID when daemon.pid exists but process dead", async () => {
    writeFileSync(join(dir, "daemon.pid"), "999999999");
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "--port", "19999"]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("Stale daemon PID"));
  });

  it("shows no bots when list is empty", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "--port", "19999"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No bots configured");
  });

  it("outputs JSON when --json flag is set", async () => {
    const deps = makeDeps({ mechaDir: dir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "--port", "19999"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        daemon: expect.objectContaining({ running: false }),
        server: expect.objectContaining({ alive: false, port: 19999 }),
        bots: [],
      }),
    );
  });

  it("shows bot table when bots exist", async () => {
    const deps = makeDeps({
      mechaDir: dir,
      pm: {
        list: vi.fn().mockReturnValue([
          { name: "alice", state: "running", port: 7700, workspacePath: "/workspace" },
        ]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "--port", "19999"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "Workspace"],
      [["alice", "running", "7700", "/workspace"]],
    );
  });

  it("detects port from agent.json", async () => {
    writeFileSync(join(dir, "agent.json"), JSON.stringify({ port: 9999, pid: 1 }));
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status"]);
    // Server will be unreachable on port 9999, but it should try that port
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("9999"));
  });
});
