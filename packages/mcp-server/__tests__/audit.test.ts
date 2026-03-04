import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuditLog, type AuditEntry } from "../src/audit.js";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: "2026-02-27T10:00:00Z",
    client: "test-client/1.0",
    tool: "mecha_list_bots",
    params: {},
    result: "ok",
    durationMs: 42,
    ...overrides,
  };
}

describe("AuditLog", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "audit-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends and reads entries", () => {
    const log = createAuditLog(dir);
    log.append(makeEntry({ tool: "mecha_list_bots" }));
    log.append(makeEntry({ tool: "mecha_discover" }));

    const entries = log.read();
    expect(entries).toHaveLength(2);
    // newest first
    expect(entries[0]!.tool).toBe("mecha_discover");
    expect(entries[1]!.tool).toBe("mecha_list_bots");
  });

  it("respects limit option", () => {
    const log = createAuditLog(dir);
    log.append(makeEntry({ tool: "a" }));
    log.append(makeEntry({ tool: "b" }));
    log.append(makeEntry({ tool: "c" }));

    const entries = log.read({ limit: 2 });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.tool).toBe("c");
    expect(entries[1]!.tool).toBe("b");
  });

  it("returns empty array when file does not exist", () => {
    const log = createAuditLog(dir);
    expect(log.read()).toEqual([]);
  });

  it("clears the audit log", () => {
    const log = createAuditLog(dir);
    log.append(makeEntry());
    log.append(makeEntry());
    expect(log.read()).toHaveLength(2);

    log.clear();
    expect(log.read()).toEqual([]);
  });

  it("truncates params exceeding 1KB", () => {
    const log = createAuditLog(dir);
    const largeValue = "x".repeat(2000);
    log.append(makeEntry({ params: { data: largeValue } }));

    const entries = log.read();
    expect(entries).toHaveLength(1);
    const params = entries[0]!.params as { _truncated?: string };
    expect(params._truncated).toBeDefined();
    expect(params._truncated!.endsWith("...(truncated)")).toBe(true);
  });

  it("preserves params under 1KB", () => {
    const log = createAuditLog(dir);
    const params = { target: "alice", limit: 10 };
    log.append(makeEntry({ params }));

    const entries = log.read();
    expect(entries[0]!.params).toEqual(params);
  });

  it("stores error field for error results", () => {
    const log = createAuditLog(dir);
    log.append(makeEntry({ result: "error", error: "bot not found" }));

    const entries = log.read();
    expect(entries[0]!.result).toBe("error");
    expect(entries[0]!.error).toBe("bot not found");
  });
});
