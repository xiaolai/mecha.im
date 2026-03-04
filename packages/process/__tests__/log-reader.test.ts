import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BotName } from "@mecha/core";
import { writeState } from "../src/state-store.js";
import { readLogs } from "../src/log-reader.js";

function streamToString(stream: import("node:stream").Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    stream.on("data", (c) => chunks.push(String(c)));
    stream.on("end", () => resolve(chunks.join("")));
    stream.on("error", reject);
  });
}

describe("readLogs", () => {
  let botDir: string;
  const name = "test-bot" as BotName;

  beforeEach(() => {
    botDir = mkdtempSync(join(tmpdir(), "logs-"));
    mkdirSync(join(botDir, "logs"), { recursive: true });
    writeState(botDir, {
      name: "test-bot",
      state: "running",
      workspacePath: "/tmp",
      pid: process.pid,
    });
  });

  it("reads both stdout and stderr", async () => {
    writeFileSync(join(botDir, "logs", "stdout.log"), "stdout line\n");
    writeFileSync(join(botDir, "logs", "stderr.log"), "stderr line\n");

    const stream = readLogs(botDir, name);
    const content = await streamToString(stream);

    expect(content).toContain("stdout line");
    expect(content).toContain("stderr line");
  });

  it("returns empty stream when no logs exist", async () => {
    // Remove the logs dir contents — no log files
    const stream = readLogs(botDir, name);
    const content = await streamToString(stream);
    expect(content).toBe("");
  });

  it("applies --tail to limit output", async () => {
    writeFileSync(join(botDir, "logs", "stdout.log"), "line1\nline2\nline3\nline4\nline5\n");

    const stream = readLogs(botDir, name, { tail: 2 });
    const content = await streamToString(stream);

    expect(content).toBe("line4\nline5\n");
  });

  it("handles tail larger than line count", async () => {
    writeFileSync(join(botDir, "logs", "stdout.log"), "only\n");

    const stream = readLogs(botDir, name, { tail: 100 });
    const content = await streamToString(stream);

    expect(content).toBe("only\n");
  });

  it("throws BotNotFoundError for missing bot", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "empty-"));
    expect(() => readLogs(emptyDir, name)).toThrow("not found");
  });

  it("reads only stdout when stderr is missing", async () => {
    writeFileSync(join(botDir, "logs", "stdout.log"), "stdout only\n");

    const stream = readLogs(botDir, name);
    const content = await streamToString(stream);

    expect(content).toBe("stdout only\n");
  });

  it("reads only stderr when stdout is missing", async () => {
    writeFileSync(join(botDir, "logs", "stderr.log"), "stderr only\n");

    const stream = readLogs(botDir, name);
    const content = await streamToString(stream);

    expect(content).toBe("stderr only\n");
  });

  it("tail works without trailing newline", async () => {
    writeFileSync(join(botDir, "logs", "stdout.log"), "a\nb\nc");

    const stream = readLogs(botDir, name, { tail: 2 });
    const content = await streamToString(stream);

    expect(content).toBe("b\nc");
  });
});
