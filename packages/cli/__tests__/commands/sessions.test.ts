import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

// Mock @mecha/service session functions
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaSessionList: vi.fn().mockResolvedValue([{ id: "s1", title: "Test" }]),
    casaSessionGet: vi.fn().mockResolvedValue({ id: "s1", title: "Test", events: [] }),
  };
});

describe("sessions commands", () => {
  it("lists sessions", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sessions", "list", "researcher"]);
    expect(deps.formatter.json).toHaveBeenCalledWith([{ id: "s1", title: "Test" }]);
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
});
