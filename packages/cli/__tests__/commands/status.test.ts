import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerStatusCommand } from "../../src/commands/status.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockMechaStatus = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaStatus: (...args: unknown[]) => mockMechaStatus(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

const fakeStatus = {
  id: "mx-test-abc123",
  name: "mecha-mx-test-abc123",
  state: "running",
  running: true,
  port: 7700,
  path: "/home/user/project",
  image: "mecha-runtime:latest",
  startedAt: "2024-01-01T00:00:00Z",
  finishedAt: "",
};

describe("mecha status", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockMechaStatus.mockResolvedValue(fakeStatus);
  });

  it("shows status info", async () => {
    const program = new Command();
    registerStatusCommand(program, deps);
    await program.parseAsync(["status", "mx-test-abc123"], { from: "user" });

    expect(formatter.info).toHaveBeenCalled();
    const calls = (formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.some((c: string) => c.includes("running"))).toBe(true);
  });

  it("outputs JSON when --json flag is set", async () => {
    const program = new Command();
    program.option("--json", "JSON output");
    registerStatusCommand(program, deps);
    await program.parseAsync(["--json", "status", "mx-test-abc123"], { from: "user" });

    expect(formatter.json).toHaveBeenCalledTimes(1);
    const data = (formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.id).toBe("mx-test-abc123");
    expect(data.state).toBe("running");
  });

  it("shows empty string when startedAt is undefined", async () => {
    mockMechaStatus.mockResolvedValueOnce({ ...fakeStatus, startedAt: undefined });

    const program = new Command();
    registerStatusCommand(program, deps);
    await program.parseAsync(["status", "mx-test-abc123"], { from: "user" });

    const calls = (formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const startedLine = calls.find((c: string) => c.includes("Started:"));
    expect(startedLine).toBeDefined();
    expect(startedLine).toMatch(/Started:\s*$/);
  });

  it("reports errors", async () => {
    mockMechaStatus.mockRejectedValueOnce(new Error("not found"));

    const program = new Command();
    registerStatusCommand(program, deps);
    await program.parseAsync(["status", "mx-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  describe("--watch mode", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("registers SIGINT handler that calls process.exit", async () => {
      mockMechaStatus.mockRejectedValue(new Error("not found"));
      const onSpy = vi.spyOn(process, "on");
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      const program = new Command();
      registerStatusCommand(program, deps);
      const p = program.parseAsync(["status", "--watch", "mx-bad"], { from: "user" });

      // Let 3 errors happen to terminate the loop
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6000);
      await vi.advanceTimersByTimeAsync(0);
      await p;

      // Find and invoke the SIGINT handler
      const sigintCall = onSpy.mock.calls.find((c) => c[0] === "SIGINT");
      expect(sigintCall).toBeDefined();
      const handler = sigintCall![1] as () => void;
      expect(() => handler()).toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);

      onSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("exits after 3 consecutive errors", async () => {
      mockMechaStatus.mockRejectedValue(new Error("not found"));

      const program = new Command();
      registerStatusCommand(program, deps);
      const p = program.parseAsync(["status", "--watch", "mx-bad"], { from: "user" });

      // Iteration 1: printStatus fails (exitCode=1), consecutiveErrors=1, delay=4000ms
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(4000);

      // Iteration 2: fails again, consecutiveErrors=2, delay=6000ms
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6000);

      // Iteration 3: fails again, consecutiveErrors=3, breaks
      await vi.advanceTimersByTimeAsync(0);

      await p;

      expect(formatter.error).toHaveBeenCalledTimes(3);
      expect(process.exitCode).toBe(1);
    });

    it("resets consecutive errors on success", async () => {
      // success, fail, success, then 3 fails to exit
      mockMechaStatus
        .mockResolvedValueOnce(fakeStatus)  // success: consecutiveErrors=0
        .mockRejectedValueOnce(new Error("fail"))  // fail: consecutiveErrors=1
        .mockResolvedValueOnce(fakeStatus)  // success: consecutiveErrors=0
        .mockRejectedValueOnce(new Error("fail"))  // fail: consecutiveErrors=1
        .mockRejectedValueOnce(new Error("fail"))  // fail: consecutiveErrors=2
        .mockRejectedValueOnce(new Error("fail")); // fail: consecutiveErrors=3 -> break

      const program = new Command();
      registerStatusCommand(program, deps);
      const p = program.parseAsync(["status", "--watch", "mx-bad"], { from: "user" });

      // Iteration 1: success, exitCode not set, consecutiveErrors=0, delay=2000
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);

      // Iteration 2: fail, exitCode=1, consecutiveErrors=1, delay=4000
      await vi.advanceTimersByTimeAsync(0);
      process.exitCode = undefined; // Reset for next success check
      await vi.advanceTimersByTimeAsync(4000);

      // Iteration 3: success, exitCode not set (since mechaStatus succeeds, exitCode stays undefined), consecutiveErrors=0, delay=2000
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);

      // Iteration 4: fail, consecutiveErrors=1, delay=4000
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(4000);

      // Iteration 5: fail, consecutiveErrors=2, delay=6000
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6000);

      // Iteration 6: fail, consecutiveErrors=3, breaks
      await vi.advanceTimersByTimeAsync(0);

      await p;

      // 4 errors total (iterations 2, 4, 5, 6)
      expect(formatter.error).toHaveBeenCalledTimes(4);
      // mechaStatus was called 6 times
      expect(mockMechaStatus).toHaveBeenCalledTimes(6);
    });
  });
});
