import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { spawn as spawnChild } from "node:child_process";

// On Linux, isPidMecha reads /proc/<pid>/cmdline and rejects non-mecha processes (e.g. `sleep`).
// Mock the lifecycle module so stopDaemon skips the process identity check in tests.
vi.mock("../../../meter/src/lifecycle.js", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  if (platform() !== "linux") return mod;
  return { ...mod, isPidMecha: () => true };
});

import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("meter command", () => {
  let tempDir: string;
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  describe("meter start", () => {
    it("starts proxy daemon", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const mechaDir = tempDir;
      const deps = makeDeps({
        mechaDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);

      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Metering proxy started"),
      );
      // proxy.json should exist
      expect(existsSync(join(mechaDir, "meter", "proxy.json"))).toBe(true);
    });

    it("rejects invalid port", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "abc"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("rejects port 0 explicitly (but port 0 gets random port)", async () => {
      // Port 0 is technically valid (OS assigns), so it should succeed
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({
        mechaDir: tempDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);
      // Port 0 means let OS pick — this should still succeed
      expect(deps.formatter.success).toHaveBeenCalled();
    });

    it("shows JSON output when --json flag is set", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({
        mechaDir: tempDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      (deps.formatter as { isJson: boolean }).isJson = true;
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);

      expect(deps.formatter.json).toHaveBeenCalledWith(
        expect.objectContaining({ pid: process.pid }),
      );
    });

    it("starts without registerShutdownHook", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({ mechaDir: tempDir });
      // Explicitly no registerShutdownHook
      delete deps.registerShutdownHook;
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);

      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Metering proxy started"),
      );
      // Manual cleanup: we need to close the server
      // Since there's no shutdown hook, we can just leave it — the test process will exit
    });

    it("reports already running", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({
        mechaDir: tempDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);
      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("already running"),
      );
    });
  });

  describe("meter stop", () => {
    it("reports not running when no proxy", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "stop"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not running"),
      );
    });

    it("sends SIGTERM to running proxy", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      // Spawn a child process to act as proxy.
      // Use node with "mecha" in argv so isPidMecha() passes on Linux (/proc/<pid>/cmdline).
      const child = spawnChild(process.execPath, ["-e", "setInterval(()=>{},9e6)/*mecha*/"], { detached: true, stdio: "ignore" });
      child.unref();
      const pid = child.pid!;
      try {
        const mDir = join(tempDir, "meter");
        mkdirSync(mDir, { recursive: true });
        writeFileSync(join(mDir, "proxy.json"), JSON.stringify({
          port: 7600, pid, required: false, startedAt: new Date().toISOString(),
        }));

        const deps = makeDeps({ mechaDir: tempDir });
        const program = createProgram(deps);
        program.exitOverride();

        await program.parseAsync(["node", "mecha", "meter", "stop"]);

        expect(deps.formatter.success).toHaveBeenCalledWith(
          expect.stringContaining("stopped"),
        );
      } finally {
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    });
  });

  describe("meter status", () => {
    it("shows not running when no proxy", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("not running"),
      );
    });

    it("shows running status after start", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({
        mechaDir: tempDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0"]);
      // Reset formatter mocks
      deps.formatter.info = vi.fn();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("running"),
      );
    });

    it("shows required mode when started with --required", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({
        mechaDir: tempDir,
        registerShutdownHook: (fn) => { cleanups.push(fn); },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "start", "--port", "0", "--required"]);
      deps.formatter.info = vi.fn();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      const calls = (deps.formatter.info as ReturnType<typeof import("vitest").vi.fn>).mock.calls;
      const allText = calls.map((c: unknown[]) => c[0]).join("\n");
      expect(allText).toContain("required");
    });

    it("shows uptime in days when proxy started long ago", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const mDir = join(tempDir, "meter");
      mkdirSync(mDir, { recursive: true });
      // 3 days ago
      const started = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(mDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: process.pid, required: false, startedAt: started,
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls;
      const allText = calls.map((c: unknown[]) => c[0]).join("\n");
      expect(allText).toContain("3d");
    });

    it("shows uptime in hours", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const mDir = join(tempDir, "meter");
      mkdirSync(mDir, { recursive: true });
      const started = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(mDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: process.pid, required: false, startedAt: started,
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls;
      const allText = calls.map((c: unknown[]) => c[0]).join("\n");
      expect(allText).toContain("5h");
    });

    it("shows uptime in minutes", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const mDir = join(tempDir, "meter");
      mkdirSync(mDir, { recursive: true });
      const started = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      writeFileSync(join(mDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: process.pid, required: false, startedAt: started,
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls;
      const allText = calls.map((c: unknown[]) => c[0]).join("\n");
      expect(allText).toContain("15m");
    });

    it("shows status without startedAt", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const mDir = join(tempDir, "meter");
      mkdirSync(mDir, { recursive: true });
      writeFileSync(join(mDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: process.pid, required: false,
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("running"),
      );
    });

    it("shows JSON output", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-meter-"));
      const deps = makeDeps({ mechaDir: tempDir });
      (deps.formatter as { isJson: boolean }).isJson = true;
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "meter", "status"]);

      expect(deps.formatter.json).toHaveBeenCalledWith(
        expect.objectContaining({ running: false }),
      );
    });
  });
});
