import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  delete process.env.MECHA_AGENT_API_KEY;
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

vi.mock("@mecha/dashboard", () => ({
  startDashboard: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("start command", () => {
  it("starts agent server and dashboard", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const hooks: Array<() => Promise<void>> = [];
    const deps = makeDeps({ registerShutdownHook: (fn) => hooks.push(fn) });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Agent server started"));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Dashboard started"));
  });

  it("errors without API key", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("API key required"));
    expect(process.exitCode).toBe(1);
  });

  it("rejects invalid agent port", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    expect(process.exitCode).toBe(1);
  });

  it("rejects invalid dashboard port", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--dashboard-port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid dashboard port"));
    expect(process.exitCode).toBe(1);
  });

  it("forwards port options", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "7700", "--dashboard-port", "4000"]);
    expect(mockServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 7700 }));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Agent server started"));
  });
});
