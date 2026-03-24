import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { CommandDeps } from "../../src/types.js";

// Mock child_process.execFile for rsync
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: "", stderr: "" });
    }),
  };
});

import { execFile } from "node:child_process";

describe("team sync command", () => {
  let mechaDir: string;
  let workspaceDir: string;
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-team-sync-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "mecha-workspace-"));
    deps = makeDeps({ mechaDir });
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  function run(args: string[]) {
    const program = createProgram(deps);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    return program.parseAsync(["node", "mecha", ...args]);
  }

  function writeTeam(name: string, opts: { workspace?: string } = {}) {
    const teamsData = [
      {
        name,
        bots: ["alice", "bob"],
        workspace: opts.workspace ?? workspaceDir,
        deployedAt: "2026-01-01T00:00:00Z",
      },
    ];
    writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));
  }

  function writeNodes() {
    const nodesData = [
      { name: "node1", host: "10.0.0.1", port: 7660, apiKey: "k1", addedAt: "2026-01-01T00:00:00Z" },
      { name: "node2", host: "10.0.0.2", port: 7660, apiKey: "k2", addedAt: "2026-01-01T00:00:00Z" },
    ];
    writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify(nodesData));
  }

  it("registers the team sync subcommand", () => {
    const program = createProgram(deps);
    const teamCmd = program.commands.find((c) => c.name() === "team");
    expect(teamCmd).toBeDefined();
    const syncCmd = teamCmd!.commands.find((c) => c.name() === "sync");
    expect(syncCmd).toBeDefined();
  });

  it("errors when team is not found", async () => {
    await run(["team", "sync", "ghost"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining('"ghost" not found'),
    );
    expect(process.exitCode).toBe(1);
  });

  it("errors when team has no workspace", async () => {
    const teamsData = [
      { name: "no-ws", bots: ["a"], deployedAt: "2026-01-01T00:00:00Z" },
    ];
    writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

    await run(["team", "sync", "no-ws"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("no workspace configured"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("errors when workspace directory does not exist", async () => {
    writeTeam("test-team", { workspace: "/nonexistent/workspace" });

    await run(["team", "sync", "test-team"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("errors when no nodes are registered", async () => {
    writeTeam("test-team");

    await run(["team", "sync", "test-team"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("No registered nodes"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("errors when specified node is not found", async () => {
    writeTeam("test-team");

    await run(["team", "sync", "test-team", "--node", "ghost"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining('"ghost" not found'),
    );
    expect(process.exitCode).toBe(1);
  });

  it("runs rsync for each node", async () => {
    writeTeam("test-team");
    writeNodes();

    await run(["team", "sync", "test-team"]);

    expect(execFile).toHaveBeenCalledTimes(2);

    // Verify first rsync call arguments
    const firstCall = vi.mocked(execFile).mock.calls[0]!;
    expect(firstCall[0]).toBe("rsync");
    const args = firstCall[1] as string[];
    expect(args).toContain("-az");
    expect(args).toContain("--delete");
    expect(args).toContain(`${workspaceDir}/`);
    expect(args).toContain(`10.0.0.1:${workspaceDir}/`);

    // Verify second rsync call targets second node
    const secondCall = vi.mocked(execFile).mock.calls[1]!;
    const args2 = secondCall[1] as string[];
    expect(args2).toContain(`10.0.0.2:${workspaceDir}/`);

    expect(deps.formatter.success).toHaveBeenCalledWith("Synced workspace to 2 node(s)");
  });

  it("passes --dry-run flag to rsync", async () => {
    writeTeam("test-team");
    writeNodes();

    await run(["team", "sync", "test-team", "--dry-run"]);

    const firstCall = vi.mocked(execFile).mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("--dry-run");
  });

  it("syncs to a specific node only when --node is provided", async () => {
    writeTeam("test-team");
    writeNodes();

    await run(["team", "sync", "test-team", "--node", "node2"]);

    expect(execFile).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(execFile).mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain(`10.0.0.2:${workspaceDir}/`);

    expect(deps.formatter.success).toHaveBeenCalledWith("Synced workspace to 1 node(s)");
  });
});
