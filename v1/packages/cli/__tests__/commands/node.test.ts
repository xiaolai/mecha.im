import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerNodeCommand } from "../../src/commands/node.js";

const mockAddNode = vi.fn();
const mockRemoveNode = vi.fn();
const mockReadNodes = vi.fn();
const mockProbeMechaAgent = vi.fn();
const mockDiscoverMechaNodes = vi.fn();

vi.mock("@mecha/agent", () => ({
  addNode: (...args: unknown[]) => mockAddNode(...args),
  removeNode: (...args: unknown[]) => mockRemoveNode(...args),
  readNodes: () => mockReadNodes(),
  probeMechaAgent: (...args: unknown[]) => mockProbeMechaAgent(...args),
  discoverMechaNodes: (...args: unknown[]) => mockDiscoverMechaNodes(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha node", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as never, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  describe("node add", () => {
    it("adds a node and shows success", async () => {
      mockAddNode.mockReturnValue({ name: "a", host: "1.2.3.4:7660", key: "k1" });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "add", "a", "1.2.3.4:7660", "--key", "k1"], { from: "user" });

      expect(mockAddNode).toHaveBeenCalledWith("a", "1.2.3.4:7660", "k1");
      expect(formatter.success).toHaveBeenCalledWith("Node added: a (1.2.3.4:7660)");
    });

    it("reports error on duplicate", async () => {
      mockAddNode.mockImplementation(() => { throw new Error('Node "a" already exists'); });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "add", "a", "1.2.3.4:7660", "--key", "k1"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("node rm", () => {
    it("removes a node and shows success", async () => {
      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "rm", "a"], { from: "user" });

      expect(mockRemoveNode).toHaveBeenCalledWith("a");
      expect(formatter.success).toHaveBeenCalledWith("Node removed: a");
    });

    it("reports error when node not found", async () => {
      mockRemoveNode.mockImplementation(() => { throw new Error('Node "x" not found'); });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "rm", "x"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("node ls", () => {
    it("shows table of registered nodes", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4:7660", key: "abcdef1234567890" },
      ]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ls"], { from: "user" });

      expect(formatter.table).toHaveBeenCalledWith(
        [{ NAME: "a", HOST: "1.2.3.4:7660", KEY: "abcdef12..." }],
        ["NAME", "HOST", "KEY"],
      );
    });

    it("shows info when no nodes registered", async () => {
      mockReadNodes.mockReturnValue([]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ls"], { from: "user" });

      expect(formatter.info).toHaveBeenCalledWith("No nodes registered");
    });

    it("reports error on failure", async () => {
      mockReadNodes.mockImplementation(() => { throw new Error("fs error"); });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ls"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("fs error"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("node ping", () => {
    it("pings all nodes when no name given", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4:7660", key: "k1" },
      ]);
      mockProbeMechaAgent.mockResolvedValue({ ok: true, node: "machine-a" });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping"], { from: "user" });

      expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("OK"));
    });

    it("pings specific node by name", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4:7660", key: "k1" },
        { name: "b", host: "5.6.7.8:7660", key: "k2" },
      ]);
      mockProbeMechaAgent.mockResolvedValue({ ok: false });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "b"], { from: "user" });

      expect(mockProbeMechaAgent).toHaveBeenCalledTimes(1);
      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("UNREACHABLE"));
    });

    it("shows info when specified node not found", async () => {
      mockReadNodes.mockReturnValue([]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "ghost"], { from: "user" });

      expect(formatter.info).toHaveBeenCalledWith('Node "ghost" not found');
    });

    it("shows info when no nodes registered and no name given", async () => {
      mockReadNodes.mockReturnValue([]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping"], { from: "user" });

      expect(formatter.info).toHaveBeenCalledWith("No nodes registered");
    });

    it("handles host without port", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4", key: "k1" },
      ]);
      mockProbeMechaAgent.mockResolvedValue({ ok: true, node: "a" });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "a"], { from: "user" });

      // host "1.2.3.4" has no port, URL parsing defaults to 7660
      expect(mockProbeMechaAgent).toHaveBeenCalledWith("1.2.3.4", 7660);
    });

    it("handles host with protocol prefix", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "https://secure.host:8080", key: "k1" },
      ]);
      mockProbeMechaAgent.mockResolvedValue({ ok: true, node: "a" });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "a"], { from: "user" });

      expect(mockProbeMechaAgent).toHaveBeenCalledWith("secure.host", 8080);
    });

    it("reports error when probe throws", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4:7660", key: "k1" },
      ]);
      mockProbeMechaAgent.mockRejectedValue(new Error("network failure"));

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "a"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("network failure"));
      expect(process.exitCode).toBe(1);
    });

    it("handles probe result with undefined node", async () => {
      mockReadNodes.mockReturnValue([
        { name: "a", host: "1.2.3.4:7660", key: "k1" },
      ]);
      mockProbeMechaAgent.mockResolvedValue({ ok: true });

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "ping", "a"], { from: "user" });

      expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("node=?"));
    });
  });

  describe("node discover", () => {
    it("shows discovered agents", async () => {
      mockDiscoverMechaNodes.mockResolvedValue([
        { name: "machine-a", host: "100.64.0.1:7660", key: "" },
      ]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover"], { from: "user" });

      expect(formatter.info).toHaveBeenCalledWith("Discovering mecha agents on tailnet...");
      expect(formatter.table).toHaveBeenCalledWith(
        [{ NAME: "machine-a", HOST: "100.64.0.1:7660" }],
        ["NAME", "HOST"],
      );
      expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("Found 1 agent(s)"));
    });

    it("shows info when no agents found", async () => {
      mockDiscoverMechaNodes.mockResolvedValue([]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover"], { from: "user" });

      expect(formatter.info).toHaveBeenCalledWith("No mecha agents found on tailnet peers");
    });

    it("reports error when tailscale not available", async () => {
      mockDiscoverMechaNodes.mockRejectedValue(new Error("tailscale: command not found"));

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("tailscale"));
      expect(process.exitCode).toBe(1);
    });

    it("uses custom port", async () => {
      mockDiscoverMechaNodes.mockResolvedValue([]);

      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover", "-p", "8080"], { from: "user" });

      expect(mockDiscoverMechaNodes).toHaveBeenCalledWith({ port: 8080 });
    });

    it("rejects invalid discover port", async () => {
      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover", "-p", "abc"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith("Invalid port: abc");
      expect(process.exitCode).toBe(1);
    });

    it("rejects out-of-range discover port", async () => {
      const program = new Command();
      registerNodeCommand(program, deps);
      await program.parseAsync(["node", "discover", "-p", "99999"], { from: "user" });

      expect(formatter.error).toHaveBeenCalledWith("Invalid port: 99999");
      expect(process.exitCode).toBe(1);
    });
  });
});
