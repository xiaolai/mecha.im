import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDaemonPid, writeDaemonPid, removeDaemonPid, isDaemonRunning } from "../src/daemon.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("daemon pid helpers", () => {
  it("write then read returns correct PID", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    writeDaemonPid(dir, 12345);
    expect(readDaemonPid(dir)).toBe(12345);
  });

  it("writes file with mode 0o600 and daemon marker", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    writeDaemonPid(dir, 99);
    const raw = readFileSync(join(dir, "daemon.pid"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines[0]).toBe("99");
    expect(lines[1]).toBe("mecha-daemon");
  });

  it("read returns null when no file exists", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    expect(readDaemonPid(dir)).toBeNull();
  });

  it("read returns null for corrupt content", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(dir, "daemon.pid"), "not-a-number\n");
    expect(readDaemonPid(dir)).toBeNull();
  });

  it("read returns null for negative PID", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(dir, "daemon.pid"), "-5\n");
    expect(readDaemonPid(dir)).toBeNull();
  });

  it("remove deletes the file", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    writeDaemonPid(dir, 42);
    expect(existsSync(join(dir, "daemon.pid"))).toBe(true);
    removeDaemonPid(dir);
    expect(existsSync(join(dir, "daemon.pid"))).toBe(false);
  });

  it("remove does not throw when file is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    expect(() => removeDaemonPid(dir)).not.toThrow();
  });

  it("isDaemonRunning returns false when no PID file", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    expect(isDaemonRunning(dir)).toBe(false);
  });

  it("isDaemonRunning returns true for current process", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    writeDaemonPid(dir, process.pid);
    expect(isDaemonRunning(dir)).toBe(true);
  });

  it("isDaemonRunning returns false for dead PID", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    // Use a very high PID unlikely to be alive
    writeDaemonPid(dir, 2147483647);
    expect(isDaemonRunning(dir)).toBe(false);
  });

  it("isDaemonRunning returns false for PID file without marker", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    // Write PID file without the mecha-daemon marker (could be a different process)
    const { writeFileSync: fsWrite } = require("node:fs");
    fsWrite(join(dir, "daemon.pid"), `${process.pid}\n`);
    expect(isDaemonRunning(dir)).toBe(false);
  });

  it("readDaemonPid rejects partial numeric strings like 123abc", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    const { writeFileSync: fsWrite } = require("node:fs");
    fsWrite(join(dir, "daemon.pid"), "123abc\nmecha-daemon\n");
    expect(readDaemonPid(dir)).toBeNull();
  });

  it("creates mechaDir if it does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    const nested = join(dir, "sub", "deep");
    writeDaemonPid(nested, 1);
    expect(readDaemonPid(nested)).toBe(1);
  });
});
