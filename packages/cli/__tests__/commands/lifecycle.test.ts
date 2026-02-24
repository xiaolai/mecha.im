import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

const RUNNING_INFO: ProcessInfo = {
  name: "test" as CasaName,
  state: "running",
  pid: 12345,
  port: 7700,
  workspacePath: "/workspace",
  token: "tok",
  startedAt: "2026-01-01T00:00:00Z",
};

function defaultPm(): Partial<ProcessManager> {
  return {
    spawn: vi.fn().mockResolvedValue(RUNNING_INFO),
    get: vi.fn().mockReturnValue(RUNNING_INFO),
    list: vi.fn().mockReturnValue([RUNNING_INFO]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn().mockReturnValue(new Readable({ read() { this.push(null); } })),
    getPortAndToken: vi.fn().mockReturnValue({ port: 7700, token: "tok" }),
  };
}

describe("spawn command", () => {
  it("spawns a CASA", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "researcher", "/home/user/research"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "researcher", workspacePath: "/home/user/research" }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });

  it("spawns with port option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--port", "7701"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7701 }),
    );
  });

  it("rejects invalid port value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Port must be"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("spawns with auth option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--auth", "personal"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "personal" }),
    );
  });
});

describe("kill command", () => {
  it("kills a CASA", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "kill", "researcher"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("researcher");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Killed"));
  });
});

describe("ls command", () => {
  it("lists CASAs", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalled();
  });

  it("shows message when no CASAs", async () => {
    const deps = makeDeps({ pm: { ...defaultPm(), list: vi.fn().mockReturnValue([]) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No CASAs running");
  });

  it("shows dash for undefined port/pid", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([
          { name: "x", state: "stopped", port: undefined, pid: undefined },
        ]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "PID"],
      [["x", "stopped", "-", "-"]],
    );
  });
});

describe("status command", () => {
  it("shows CASA status without token", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("token");
    expect(jsonArg.name).toBe("test");
    expect(jsonArg.state).toBe("running");
  });
});

describe("logs command", () => {
  it("streams logs", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test"]);
    expect(deps.processManager.logs).toHaveBeenCalledWith("test", {
      follow: undefined,
      tail: undefined,
    });
  });

  it("writes log data to stdout", async () => {
    const logStream = new Readable({
      read() {
        this.push(Buffer.from("log line\n"));
        this.push(null);
      },
    });
    const deps = makeDeps({ pm: { ...defaultPm(), logs: vi.fn().mockReturnValue(logStream) } });
    const program = createProgram(deps);
    program.exitOverride();

    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: Buffer | string) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      await program.parseAsync(["node", "mecha", "logs", "test"]);
    } finally {
      process.stdout.write = origWrite;
    }
    expect(writes.join("")).toContain("log line");
  });

  it("rejects invalid tail value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test", "-n", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Tail must be"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("passes follow and tail options", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test", "-f", "-n", "50"]);
    expect(deps.processManager.logs).toHaveBeenCalledWith("test", {
      follow: true,
      tail: 50,
    });
  });
});
