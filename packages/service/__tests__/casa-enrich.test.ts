import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CasaName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import type { HotSnapshot, CostSummary } from "@mecha/meter";
import { enrichCasaInfo, buildEnrichContext } from "../src/casa-enrich.js";
import { writeCasaConfig } from "../../core/__tests__/test-utils.js";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    name: "alice" as CasaName,
    state: "running",
    port: 7700,
    workspacePath: "/ws/project",
    startedAt: "2026-03-02T10:00:00.000Z",
    ...overrides,
  };
}

function emptySummary(): CostSummary {
  return {
    requests: 0, errors: 0, inputTokens: 0, outputTokens: 0,
    cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, avgLatencyMs: 0,
  };
}

function makeSnapshot(byCasa: Record<string, { today: CostSummary; thisMonth: CostSummary }> = {}): HotSnapshot {
  return {
    ts: "2026-03-02T12:00:00.000Z",
    date: "2026-03-02",
    global: { today: emptySummary(), thisMonth: emptySummary() },
    byCasa,
    byAuth: {},
    byTag: {},
  };
}

function writeAuthProfiles(mechaDir: string, profiles: Record<string, object>, defaultName: string | null = null): void {
  const dir = join(mechaDir, "auth");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "profiles.json"), JSON.stringify({ default: defaultName, profiles }));
}

describe("enrichCasaInfo", () => {
  let mechaDir: string;

  function setup() {
    mechaDir = mkdtempSync(join(tmpdir(), "enrich-"));
    return mechaDir;
  }

  function cleanup() {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
  }

  it("merges ProcessInfo and config fields", () => {
    const dir = setup();
    try {
      writeCasaConfig(dir, "alice", {
        port: 7700, token: "tok", workspace: "/ws/project",
        model: "claude-sonnet-4-20250514", sandboxMode: "auto",
        permissionMode: "default", tags: ["coder", "test"],
      });
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.name).toBe("alice");
      expect(result.state).toBe("running");
      expect(result.port).toBe(7700);
      expect(result.workspacePath).toBe("/ws/project");
      expect(result.startedAt).toBe("2026-03-02T10:00:00.000Z");
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.sandboxMode).toBe("auto");
      expect(result.permissionMode).toBe("default");
      expect(result.tags).toEqual(["coder", "test"]);
    } finally { cleanup(); }
  });

  it("returns only ProcessInfo fields when config is missing", () => {
    const dir = setup();
    try {
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.name).toBe("alice");
      expect(result.state).toBe("running");
      expect(result.model).toBeUndefined();
      expect(result.sandboxMode).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.auth).toBeUndefined();
    } finally { cleanup(); }
  });

  it("resolves authType from auth profile store", () => {
    const dir = setup();
    try {
      writeCasaConfig(dir, "alice", {
        port: 7700, token: "tok", workspace: "/ws/project", auth: "mykey",
      });
      writeAuthProfiles(dir, {
        mykey: { type: "api-key", account: null, label: "My Key", tags: [], expiresAt: null, createdAt: "2026-01-01" },
      });
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.auth).toBe("mykey");
      expect(result.authType).toBe("api-key");
    } finally { cleanup(); }
  });

  it("sets auth but not authType when profile is missing from store", () => {
    const dir = setup();
    try {
      writeCasaConfig(dir, "alice", {
        port: 7700, token: "tok", workspace: "/ws/project", auth: "gone",
      });
      writeAuthProfiles(dir, {});
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.auth).toBe("gone");
      expect(result.authType).toBeUndefined();
    } finally { cleanup(); }
  });

  it("populates costToday from meter snapshot", () => {
    const dir = setup();
    try {
      const snapshot = makeSnapshot({
        alice: {
          today: { ...emptySummary(), costUsd: 1.42 },
          thisMonth: { ...emptySummary(), costUsd: 15.00 },
        },
      });
      const ctx = buildEnrichContext(dir, snapshot, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.costToday).toBe(1.42);
    } finally { cleanup(); }
  });

  it("leaves costToday undefined when snapshot is null", () => {
    const dir = setup();
    try {
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(makeInfo(), ctx);
      expect(result.costToday).toBeUndefined();
    } finally { cleanup(); }
  });

  it("never leaks token field", () => {
    const dir = setup();
    try {
      const info = makeInfo({ token: "secret-token-123" });
      const ctx = buildEnrichContext(dir, null, ["alice"]);
      const result = enrichCasaInfo(info, ctx);
      expect((result as Record<string, unknown>).token).toBeUndefined();
    } finally { cleanup(); }
  });

  it("pre-loads all configs in buildEnrichContext", () => {
    const dir = setup();
    try {
      writeCasaConfig(dir, "alice", {
        port: 7700, token: "tok", workspace: "/ws", model: "claude-sonnet-4-20250514",
      });
      writeCasaConfig(dir, "bob", {
        port: 7701, token: "tok2", workspace: "/ws2", model: "claude-haiku-4-5-20251001",
      });
      const ctx = buildEnrichContext(dir, null, ["alice", "bob"]);
      expect(ctx.configs.size).toBe(2);
      const alice = enrichCasaInfo(makeInfo(), ctx);
      const bob = enrichCasaInfo(makeInfo({ name: "bob" as CasaName, workspacePath: "/ws2" }), ctx);
      expect(alice.model).toBe("claude-sonnet-4-20250514");
      expect(bob.model).toBe("claude-haiku-4-5-20251001");
    } finally { cleanup(); }
  });
});
