import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../../src/program.js";
import type { CommandDeps } from "../../src/types.js";
import type { ProcessManager } from "@mecha/process";

// Mock @mecha/service session functions
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaSessionList: vi.fn().mockResolvedValue([{ id: "s1", title: "Test" }]),
    casaSessionGet: vi.fn().mockResolvedValue({ id: "s1", title: "Test", messages: [] }),
    casaSessionCreate: vi.fn().mockResolvedValue({ id: "s2", title: "New" }),
    casaSessionDelete: vi.fn().mockResolvedValue(true),
    casaSessionRename: vi.fn().mockResolvedValue(true),
    casaSessionMessage: vi.fn().mockResolvedValue({ role: "user", content: "Hi" }),
    casaSessionInterrupt: vi.fn().mockResolvedValue(true),
  };
});

function makeDeps(): CommandDeps {
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
    mechaDir: "/tmp/mecha",
  };
}

describe("sessions commands", () => {
  it("lists sessions", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "list", "researcher"]);
    expect(deps.formatter.json).toHaveBeenCalled();
  });

  it("shows a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "show", "researcher", "s1"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("shows not found for missing session", async () => {
    const { casaSessionGet } = await import("@mecha/service");
    vi.mocked(casaSessionGet).mockResolvedValueOnce(undefined);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "show", "researcher", "missing"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Session not found");
  });

  it("creates a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "create", "researcher", "-t", "My Session"]);
    expect(deps.formatter.json).toHaveBeenCalled();
  });

  it("deletes a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "delete", "researcher", "s1"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("Session deleted");
  });

  it("reports delete failure", async () => {
    const { casaSessionDelete } = await import("@mecha/service");
    vi.mocked(casaSessionDelete).mockResolvedValueOnce(false);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "delete", "researcher", "missing"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Session not found");
  });

  it("sends a message", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "message", "researcher", "s1", "Hello"]);
    expect(deps.formatter.json).toHaveBeenCalled();
  });

  it("interrupts a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "interrupt", "researcher", "s1"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("Session interrupted");
  });

  it("reports interrupt failure", async () => {
    const { casaSessionInterrupt } = await import("@mecha/service");
    vi.mocked(casaSessionInterrupt).mockResolvedValueOnce(false);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "interrupt", "researcher", "s1"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Session is not busy");
  });

  it("renames a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "rename", "researcher", "s1", "New Name"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("Session renamed");
  });

  it("reports rename failure", async () => {
    const { casaSessionRename } = await import("@mecha/service");
    vi.mocked(casaSessionRename).mockResolvedValueOnce(false);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "rename", "researcher", "missing", "X"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Session not found");
  });
});
