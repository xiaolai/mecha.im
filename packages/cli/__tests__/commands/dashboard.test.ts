import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

const mockServer = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockCreateAgentServer = vi.fn().mockReturnValue(mockServer);

vi.mock("@mecha/agent", () => ({
  createAgentServer: (...args: unknown[]) => mockCreateAgentServer(...args),
}));

vi.mock("@mecha/service", () => ({
  readNodeName: vi.fn().mockReturnValue("test-node"),
}));

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

describe("dashboard commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockCreateAgentServer.mockClear();
    mockCreateAgentServer.mockReturnValue(mockServer);
    mockServer.listen.mockClear();
    process.exitCode = undefined as unknown as number;
    delete process.env.MECHA_AGENT_API_KEY;
  });

  describe("dashboard serve", () => {
    it("starts the dashboard with default port", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockCreateAgentServer).toHaveBeenCalledWith(
        expect.objectContaining({
          spaDir: "/fake/spa/dist",
        }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Dashboard started"),
      );
    });

    it("accepts custom port", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "4000"]);
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ port: 4000 }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("4000"),
      );
    });

    it("accepts custom host", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--host", "0.0.0.0"]);
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ host: "0.0.0.0" }),
      );
    });

    it("passes processManager, mechaDir, and acl to createAgentServer", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps({ mechaDir: "/custom/dir" });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockCreateAgentServer).toHaveBeenCalledWith(
        expect.objectContaining({
          processManager: deps.processManager,
          mechaDir: "/custom/dir",
          acl: deps.acl,
        }),
      );
    });

    it("reports invalid port", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
      expect(mockCreateAgentServer).not.toHaveBeenCalled();
    });

    it("reports invalid port for out-of-range values", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "99999"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors without API key", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("API key required"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when SPA not found", async () => {
      process.env.MECHA_AGENT_API_KEY = "test-key";
      const { resolveSpaDir } = await import("../../src/spa-resolve.js");
      vi.mocked(resolveSpaDir).mockReturnValueOnce(undefined);

      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("SPA not found"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
