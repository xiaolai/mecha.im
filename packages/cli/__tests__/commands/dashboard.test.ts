import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

const mockStartDashboard = vi.fn().mockResolvedValue(async () => {});

vi.mock("@mecha/dashboard", () => ({
  startDashboard: (...args: unknown[]) => mockStartDashboard(...args),
}));

describe("dashboard commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockStartDashboard.mockClear();
    mockStartDashboard.mockResolvedValue(async () => {});
    process.exitCode = undefined as unknown as number;
  });

  describe("dashboard serve", () => {
    it("starts the dashboard with default port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockStartDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3457,
          host: "127.0.0.1",
        }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        "Dashboard started on http://127.0.0.1:3457",
      );
    });

    it("accepts custom port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "4000"]);
      expect(mockStartDashboard).toHaveBeenCalledWith(
        expect.objectContaining({ port: 4000 }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        "Dashboard started on http://127.0.0.1:4000",
      );
    });

    it("accepts custom host", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--host", "0.0.0.0"]);
      expect(mockStartDashboard).toHaveBeenCalledWith(
        expect.objectContaining({ host: "0.0.0.0" }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        "Dashboard started on http://0.0.0.0:3457",
      );
    });

    it("passes processManager, mechaDir, and acl to startDashboard", async () => {
      const deps = makeDeps({ mechaDir: "/custom/dir" });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockStartDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          processManager: deps.processManager,
          mechaDir: "/custom/dir",
          acl: deps.acl,
        }),
      );
    });

    it("reports invalid port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
      expect(mockStartDashboard).not.toHaveBeenCalled();
    });

    it("reports invalid port for out-of-range values", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "99999"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
