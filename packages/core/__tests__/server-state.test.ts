import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readServerState, writeServerState, removeServerState } from "../src/server-state.js";
import type { ServerState } from "../src/server-state.js";

let dirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "server-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs = [];
});

const testState: ServerState = {
  port: 7681,
  host: "0.0.0.0",
  publicAddr: "wss://myhost.example.com:7681",
  startedAt: "2026-02-27T12:00:00.000Z",
};

describe("server-state", () => {
  it("write and read round-trip", () => {
    const dir = makeTmpDir();
    writeServerState(dir, testState);
    const result = readServerState(dir);
    expect(result).toEqual(testState);
  });

  it("readServerState returns undefined when no file", () => {
    const dir = makeTmpDir();
    expect(readServerState(dir)).toBeUndefined();
  });

  it("removeServerState cleans up file", () => {
    const dir = makeTmpDir();
    writeServerState(dir, testState);
    expect(readServerState(dir)).toBeDefined();
    removeServerState(dir);
    expect(readServerState(dir)).toBeUndefined();
  });

  it("removeServerState is safe when file doesn't exist", () => {
    const dir = makeTmpDir();
    expect(() => removeServerState(dir)).not.toThrow();
  });

  it("file is written with mode 0o600", () => {
    const dir = makeTmpDir();
    writeServerState(dir, testState);
    const stats = statSync(join(dir, "server.json"));
    // Check owner read+write only (0o600 = 33152 on macOS/Linux)
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("readServerState returns undefined for corrupt JSON", () => {
    const dir = makeTmpDir();
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(dir, "server.json"), "not json");
    expect(readServerState(dir)).toBeUndefined();
  });

  it("handles state without publicAddr", () => {
    const dir = makeTmpDir();
    const stateNoAddr: ServerState = { port: 7681, host: "127.0.0.1", startedAt: "2026-01-01T00:00:00Z" };
    writeServerState(dir, stateNoAddr);
    const result = readServerState(dir);
    expect(result).toEqual(stateNoAddr);
    expect(result?.publicAddr).toBeUndefined();
  });
});
