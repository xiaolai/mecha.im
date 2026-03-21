import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

const RUNNING_INFO: ProcessInfo = {
  name: "alice" as BotName,
  state: "running",
  pid: 12345,
  port: 7700,
  workspacePath: "/workspace",
  token: "tok",
  startedAt: "2026-01-01T00:00:00Z",
};

describe("team commands", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-team-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  describe("team deploy", () => {
    it("deploys a team from a JSON definition file", async () => {
      const teamDef = {
        name: "test-team",
        bots: {
          alice: { cwd: "/workspace/alice" },
          bob: { cwd: "/workspace/bob" },
        },
        acl: [
          { source: "alice", targets: ["bob"], capabilities: ["query"] },
        ],
      };

      const defFile = join(mechaDir, "team.json");
      writeFileSync(defFile, JSON.stringify(teamDef));

      const deps = makeDeps({
        mechaDir,
        pm: {
          spawn: vi.fn().mockResolvedValue(RUNNING_INFO),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "deploy", defFile]);

      expect(deps.processManager.spawn).toHaveBeenCalledTimes(2);
      expect(deps.acl.grant).toHaveBeenCalledWith("alice", "bob", ["query"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Deployed team"),
      );

      // Verify teams.json was created
      const teamsPath = join(mechaDir, "teams.json");
      const teams = JSON.parse(readFileSync(teamsPath, "utf-8"));
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("test-team");
      expect(teams[0].bots).toEqual(["alice", "bob"]);
    });

    it("errors on invalid JSON file", async () => {
      const defFile = join(mechaDir, "bad.json");
      writeFileSync(defFile, "not json at all {{{");

      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "deploy", defFile]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read team definition"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors on missing file", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "deploy", "/nonexistent/team.json"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read team definition"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("team list", () => {
    it("shows message when no teams deployed", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "list"]);

      expect(deps.formatter.info).toHaveBeenCalledWith("No teams deployed");
    });

    it("shows table of deployed teams", async () => {
      const teamsData = [
        {
          name: "test-team",
          bots: ["alice", "bob"],
          home: "/home/test",
          workspace: "/workspace",
          deployedAt: "2026-01-01T00:00:00Z",
        },
      ];
      writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "list"]);

      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Bots", "Home", "Workspace", "Deployed At"],
        expect.arrayContaining([
          expect.arrayContaining(["test-team", "alice, bob"]),
        ]),
      );
    });
  });

  describe("team status", () => {
    it("shows team status", async () => {
      const teamsData = [
        {
          name: "test-team",
          bots: ["alice", "bob"],
          home: "/home/test",
          workspace: "/workspace",
          deployedAt: "2026-01-01T00:00:00Z",
        },
      ];
      writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "status", "test-team"]);

      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Field", "Value"],
        expect.arrayContaining([
          ["name", "test-team"],
          ["bots", "alice, bob"],
          ["deployedAt", "2026-01-01T00:00:00Z"],
        ]),
      );
    });

    it("errors when team not found", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "status", "ghost"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("team teardown", () => {
    it("stops bots and unregisters the team", async () => {
      const teamsData = [
        {
          name: "test-team",
          bots: ["alice", "bob"],
          deployedAt: "2026-01-01T00:00:00Z",
        },
      ];
      writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

      const deps = makeDeps({
        mechaDir,
        pm: {
          get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "running" }),
          stop: vi.fn().mockResolvedValue(undefined),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "teardown", "test-team"]);

      expect(deps.processManager.stop).toHaveBeenCalledTimes(2);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("torn down"),
      );

      // Verify teams.json is empty
      const teams = JSON.parse(readFileSync(join(mechaDir, "teams.json"), "utf-8"));
      expect(teams).toHaveLength(0);
    });

    it("uses kill with --force", async () => {
      const teamsData = [
        {
          name: "test-team",
          bots: ["alice"],
          deployedAt: "2026-01-01T00:00:00Z",
        },
      ];
      writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

      const deps = makeDeps({
        mechaDir,
        pm: {
          get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "running" }),
          kill: vi.fn().mockResolvedValue(undefined),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "teardown", "test-team", "--force"]);

      expect(deps.processManager.kill).toHaveBeenCalledTimes(1);
      expect(deps.processManager.stop).not.toHaveBeenCalled();
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("torn down"),
      );
    });

    it("errors when team not found", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "teardown", "ghost"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("skips stop for already stopped bots", async () => {
      const teamsData = [
        {
          name: "test-team",
          bots: ["alice"],
          deployedAt: "2026-01-01T00:00:00Z",
        },
      ];
      writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teamsData));

      const deps = makeDeps({
        mechaDir,
        pm: {
          get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "stopped" }),
          stop: vi.fn().mockResolvedValue(undefined),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "team", "teardown", "test-team"]);

      expect(deps.processManager.stop).not.toHaveBeenCalled();
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("torn down"),
      );
    });
  });
});
