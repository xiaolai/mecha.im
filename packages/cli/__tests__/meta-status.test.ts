import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    readNodes: vi.fn().mockReturnValue([]),
  };
});

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    nodePing: vi.fn().mockResolvedValue({ reachable: true, latencyMs: 42, method: "http" }),
  };
});

import { executeMetaStatus } from "../src/commands/meta-status.js";
import { readNodes } from "@mecha/core";
import { nodePing } from "@mecha/service";

let deps: CommandDeps;
let mechaDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mechaDir = mkdtempSync(join(tmpdir(), "mecha-meta-status-"));
  deps = makeDeps({
    mechaDir,
    pm: {
      get: vi.fn().mockReturnValue({ state: "running", port: 7700 }),
    },
  });
});

describe("executeMetaStatus", () => {
  it("shows meta-agent is not running when bot not found", async () => {
    deps = makeDeps({
      mechaDir,
      pm: {
        get: vi.fn().mockReturnValue(undefined),
      },
    });

    await executeMetaStatus(deps);

    expect(deps.formatter.info).toHaveBeenCalledWith("Meta-agent is not running");
  });

  it("shows meta-agent is not running when state is stopped", async () => {
    deps = makeDeps({
      mechaDir,
      pm: {
        get: vi.fn().mockReturnValue({ state: "stopped", port: 7700 }),
      },
    });

    await executeMetaStatus(deps);

    expect(deps.formatter.info).toHaveBeenCalledWith("Meta-agent is not running");
  });

  it("shows running meta-agent with port", async () => {
    await executeMetaStatus(deps);

    expect(deps.formatter.info).toHaveBeenCalledWith("Meta-agent: running (port 7700)");
  });

  it("shows 'No workflow runs yet' when workflows dir missing", async () => {
    await executeMetaStatus(deps);

    expect(deps.formatter.info).toHaveBeenCalledWith("No workflow runs yet");
  });

  it("shows workflow run counts", async () => {
    const workflowsDir = join(mechaDir, "workflows", "runs", "test-wf");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "run-1.json"),
      JSON.stringify({ status: "running" }),
    );
    writeFileSync(
      join(workflowsDir, "run-2.json"),
      JSON.stringify({ status: "done" }),
    );

    await executeMetaStatus(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("Workflows: 1 defined, 2 runs (1 active)");
  });

  it("shows remote node status when nodes exist", async () => {
    (readNodes as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "spark01", host: "10.0.0.1", port: 7700, apiKey: "k1", addedAt: "2026-01-01" },
      { name: "spark02", host: "10.0.0.2", port: 7700, apiKey: "k2", addedAt: "2026-01-01" },
    ]);
    (nodePing as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ reachable: true, latencyMs: 12, method: "http" })
      .mockResolvedValueOnce({ reachable: false, method: "http", error: "unreachable" });

    await executeMetaStatus(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("Remote nodes:");
    expect(calls).toContainEqual("  spark01: online (12ms, http)");
    expect(calls).toContainEqual("  spark02: offline — unreachable");
  });

  it("does not show remote nodes section when no nodes registered", async () => {
    (readNodes as ReturnType<typeof vi.fn>).mockReturnValue([]);

    await executeMetaStatus(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContainEqual("Remote nodes:");
  });

  it("shows offline node without error detail", async () => {
    (readNodes as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "node1", host: "10.0.0.1", port: 7700, apiKey: "k1", addedAt: "2026-01-01" },
    ]);
    (nodePing as ReturnType<typeof vi.fn>).mockResolvedValue({ reachable: false, method: "http" });

    await executeMetaStatus(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("  node1: offline");
  });
});
