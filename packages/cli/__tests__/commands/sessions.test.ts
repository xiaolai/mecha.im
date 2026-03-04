import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

afterEach(() => { process.exitCode = undefined as unknown as number; });

// Mock @mecha/service session functions
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    botSessionList: vi.fn().mockResolvedValue([{ id: "s1", title: "Test" }]),
    botSessionGet: vi.fn().mockResolvedValue({ id: "s1", title: "Test", events: [] }),
  };
});

describe("sessions commands", () => {
  it("lists sessions in table", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "list", "researcher"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Session ID", "Title", "Created", "Updated"],
      [["s1", "Test", "-", "-"]],
    );
  });

  it("shows message when no sessions", async () => {
    const { botSessionList } = await import("@mecha/service");
    vi.mocked(botSessionList).mockResolvedValueOnce([]);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "list", "researcher"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No sessions");
  });

  it("shows a session", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "show", "researcher", "s1"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("outputs raw JSON in json mode", async () => {
    const deps = makeDeps();
    deps.formatter.isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "list", "researcher"]);
    expect(deps.formatter.json).toHaveBeenCalledWith([{ id: "s1", title: "Test" }]);
    expect(deps.formatter.table).not.toHaveBeenCalled();
  });

  it("supports ls alias", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "ls", "researcher"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Session ID", "Title", "Created", "Updated"],
      expect.any(Array),
    );
  });

  it("shows dash for missing session fields", async () => {
    const { botSessionList } = await import("@mecha/service");
    vi.mocked(botSessionList).mockResolvedValueOnce([{ weird: true }]);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "list", "researcher"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Session ID", "Title", "Created", "Updated"],
      [["-", "-", "-", "-"]],
    );
  });

  it("handles null/primitive entries gracefully", async () => {
    const { botSessionList } = await import("@mecha/service");
    vi.mocked(botSessionList).mockResolvedValueOnce([null, "string", 42]);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "list", "researcher"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Session ID", "Title", "Created", "Updated"],
      [["-", "-", "-", "-"], ["-", "-", "-", "-"], ["-", "-", "-", "-"]],
    );
  });

  it("shows not found for missing session", async () => {
    const { botSessionGet } = await import("@mecha/service");
    vi.mocked(botSessionGet).mockResolvedValueOnce(undefined);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "sessions", "show", "researcher", "missing"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Session not found");
  });
});
