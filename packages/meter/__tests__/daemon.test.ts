import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { spawn as spawnChild } from "node:child_process";
import { startDaemon, stopDaemon, meterDir } from "../src/daemon.js";
import type { DaemonHandle } from "../src/daemon.js";

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("daemon", () => {
  let tempDir: string;
  let handle: DaemonHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts and accepts connections", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const addr = handle.server.address();
    expect(addr).not.toBeNull();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const res = await httpGet(port, "/");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toContain("Invalid path");
  });

  it("writes proxy.json on start", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: true });

    const raw = readFileSync(join(tempDir, "proxy.json"), "utf-8");
    const info = JSON.parse(raw);
    expect(info.pid).toBe(process.pid);
    expect(info.required).toBe(true);
  });

  it("initializes pricing.json on start", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const raw = readFileSync(join(tempDir, "pricing.json"), "utf-8");
    const pricing = JSON.parse(raw);
    expect(pricing.models["claude-opus-4-6"]).toBeDefined();
  });

  it("rejects duplicate start with alive pid", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    await expect(startDaemon({ meterDir: tempDir, port: 0, required: false }))
      .rejects.toThrow(/already running|METER_PROXY_ALREADY_RUNNING/);
  });

  it("cleans stale proxy.json and starts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    // Write stale proxy.json with dead pid
    writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
      port: 7600, pid: 999999999, required: false, startedAt: "x",
    }));

    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });
    expect(handle.info.pid).toBe(process.pid);
  });

  it("rejects if port is in use", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const addr = handle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const dir2 = mkdtempSync(join(tmpdir(), "meter-daemon2-"));
    try {
      await expect(startDaemon({ meterDir: dir2, port, required: false }))
        .rejects.toThrow(/already in use|PORT_CONFLICT/);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close() cleans up proxy.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    await handle.close();
    handle = undefined; // prevent double-close in afterEach

    expect(existsSync(join(tempDir, "proxy.json"))).toBe(false);
  });

  describe("stopDaemon", () => {
    it("returns false when no proxy running", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      expect(stopDaemon(tempDir)).toBe(false);
    });

    it("returns false when pid is dead (cleans stale)", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: 999999999, required: false, startedAt: "x",
      }));
      expect(stopDaemon(tempDir)).toBe(false);
    });

    it("sends SIGTERM to alive process", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      // Spawn a child process we can send SIGTERM to
      const child = spawnChild("sleep", ["60"], { detached: true, stdio: "ignore" });
      child.unref();
      const pid = child.pid!;
      try {
        writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
          port: 7600, pid, required: false, startedAt: "x",
        }));
        expect(stopDaemon(tempDir)).toBe(true);
      } finally {
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    });
  });

  describe("meterDir", () => {
    it("returns path under mechaDir", () => {
      expect(meterDir("/home/user/.mecha")).toBe("/home/user/.mecha/meter");
    });
  });
});
