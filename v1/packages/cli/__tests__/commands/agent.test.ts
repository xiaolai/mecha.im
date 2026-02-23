import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerAgentCommand } from "../../src/commands/agent.js";

// Mock fs operations
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

vi.mock("node:crypto", () => ({
  randomBytes: () => ({ toString: () => "a".repeat(64) }),
}));

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return { ...actual, DEFAULTS: { ...actual.DEFAULTS, HOME_DIR: ".mecha" } };
});

const mockCreateAgentServer = vi.fn();
vi.mock("@mecha/agent", () => ({
  createAgentServer: (...args: unknown[]) => mockCreateAgentServer(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha agent", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as never, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  describe("agent start", () => {
    it("starts server with auto-generated key when no saved key", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockCreateAgentServer.mockResolvedValue({
        start: vi.fn(),
        stop: vi.fn(),
        app: {},
      });

      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start"], { from: "user" });

      expect(mockCreateAgentServer).toHaveBeenCalledWith({
        port: 7660,
        apiKey: "a".repeat(64),
      });
      expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("Mesh agent listening"));
      expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("API key: aaaaaaaa..."));
    });

    it("starts server with saved key from file", async () => {
      mockReadFileSync.mockReturnValue("saved-key-123\n");
      mockCreateAgentServer.mockResolvedValue({
        start: vi.fn(),
        stop: vi.fn(),
        app: {},
      });

      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start"], { from: "user" });

      expect(mockCreateAgentServer).toHaveBeenCalledWith({
        port: 7660,
        apiKey: "saved-key-123",
      });
    });

    it("uses explicit --key option", async () => {
      mockCreateAgentServer.mockResolvedValue({
        start: vi.fn(),
        stop: vi.fn(),
        app: {},
      });

      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start", "--key", "explicit-key"], { from: "user" });

      expect(mockCreateAgentServer).toHaveBeenCalledWith({
        port: 7660,
        apiKey: "explicit-key",
      });
    });

    it("uses custom port", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockCreateAgentServer.mockResolvedValue({
        start: vi.fn(),
        stop: vi.fn(),
        app: {},
      });

      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start", "-p", "8080"], { from: "user" });

      expect(mockCreateAgentServer).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080 }),
      );
    });

    it("rejects invalid port", async () => {
      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start", "-p", "abc"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith("Invalid port: abc");
      expect(process.exitCode).toBe(1);
    });

    it("rejects port out of range", async () => {
      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start", "-p", "99999"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith("Invalid port: 99999");
      expect(process.exitCode).toBe(1);
    });

    it("reports error when server creation fails", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockCreateAgentServer.mockRejectedValue(new Error("bind failed"));

      const program = new Command();
      registerAgentCommand(program, deps);
      await program.parseAsync(["agent", "start"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("bind failed"));
      expect(process.exitCode).toBe(1);
    });
  });
});
