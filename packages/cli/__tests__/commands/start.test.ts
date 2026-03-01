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

vi.mock("@mecha/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/process")>();
  return {
    ...actual,
    createBunPtySpawn: vi.fn().mockReturnValue(vi.fn()),
  };
});

vi.mock("../../src/spa-resolve.js", () => ({
  resolveSpaDir: vi.fn().mockReturnValue("/fake/spa/dist"),
}));

describe("start command", () => {
  it("starts agent server with SPA", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const hooks: Array<() => Promise<void>> = [];
    const deps = makeDeps({ registerShutdownHook: (fn) => hooks.push(fn) });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Mecha started"));
  });

  it("warns when SPA not found", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const { resolveSpaDir } = await import("../../src/spa-resolve.js");
    vi.mocked(resolveSpaDir).mockReturnValueOnce(undefined);

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Agent server started"));
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("SPA not found"));
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

  it("forwards port option to server", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "7700"]);
    expect(mockServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 7700 }));
  });
});
