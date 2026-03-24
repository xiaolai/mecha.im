import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deployTeam, listTeams, unregisterTeam } from "../src/deploy.js";
import type { TeamDef } from "../src/types.js";

describe("deployTeam", () => {
  let mechaDir: string;
  let workspaceDir: string;
  const spawnedBots: Array<{ name: string; opts: Record<string, unknown> }> = [];
  const grantedAcl: Array<{ source: string; target: string; caps: string[] }> = [];

  function makeSpawnBot() {
    return async (name: string, opts: Record<string, unknown>) => {
      spawnedBots.push({ name, opts });
      return true;
    };
  }

  function makeGrantAcl() {
    return (source: string, target: string, capabilities: string[]) => {
      grantedAcl.push({ source, target, caps: capabilities });
    };
  }

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-teams-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "mecha-workspace-"));
    spawnedBots.length = 0;
    grantedAcl.length = 0;
  });

  const teamDef: TeamDef = {
    name: "dev-team",
    home: "", // set in test
    workspace: "", // set in test
    bots: {
      developer: { cwd: "", model: "claude-sonnet-4-6", tags: ["engineering"] },
      reviewer: { cwd: "" },
    },
    acl: [
      { source: "developer", targets: ["reviewer"], capabilities: ["query"] },
    ],
    scaffold: {},
  };

  function makeDef(): TeamDef {
    const homeDir = mkdtempSync(join(tmpdir(), "mecha-home-"));
    return {
      ...teamDef,
      home: homeDir,
      workspace: workspaceDir,
      bots: {
        developer: { ...teamDef.bots.developer!, cwd: join(workspaceDir, "src") },
        reviewer: { ...teamDef.bots.reviewer!, cwd: workspaceDir },
      },
      scaffold: {
        [join(workspaceDir, ".claude", "CLAUDE.md")]: "# Team\nTest project.",
      },
    };
  }

  it("spawns all bots", async () => {
    const def = makeDef();
    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });

    expect(result.bots).toEqual(["developer", "reviewer"]);
    expect(spawnedBots).toHaveLength(2);
    expect(spawnedBots[0]!.name).toBe("developer");
    expect(spawnedBots[0]!.opts.home).toBe(def.home);
    expect(spawnedBots[0]!.opts.model).toBe("claude-sonnet-4-6");
  });

  it("configures ACL", async () => {
    const result = await deployTeam({
      definition: makeDef(),
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });

    expect(result.aclRules).toBe(1);
    expect(grantedAcl[0]).toEqual({
      source: "developer",
      target: "reviewer",
      caps: ["query"],
    });
  });

  it("scaffolds .claude/ files", async () => {
    const def = makeDef();
    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });

    const claudeMd = join(workspaceDir, ".claude", "CLAUDE.md");
    expect(result.scaffolded).toContain(claudeMd);
    expect(existsSync(claudeMd)).toBe(true);
    expect(readFileSync(claudeMd, "utf-8")).toContain("# Team");
  });

  it("does not overwrite existing scaffold files", async () => {
    const def = makeDef();
    // Pre-create the file
    const claudeDir = join(workspaceDir, ".claude");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# Existing", "utf-8");

    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });

    expect(result.scaffolded).toEqual([]); // not overwritten
    expect(readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8")).toBe("# Existing");
  });

  it("creates shared HOME directory", async () => {
    const def = makeDef();
    await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });
    expect(existsSync(join(def.home!, ".claude"))).toBe(true);
  });

  it("registers team in teams.json", async () => {
    await deployTeam({
      definition: makeDef(),
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });

    const teams = listTeams(mechaDir);
    expect(teams).toHaveLength(1);
    expect(teams[0]!.name).toBe("dev-team");
    expect(teams[0]!.bots).toEqual(["developer", "reviewer"]);
  });

  it("updates existing team registration on re-deploy", async () => {
    const def = makeDef();
    await deployTeam({ definition: def, mechaDir, spawnBot: makeSpawnBot(), grantAcl: makeGrantAcl() });
    await deployTeam({ definition: def, mechaDir, spawnBot: makeSpawnBot(), grantAcl: makeGrantAcl() });

    expect(listTeams(mechaDir)).toHaveLength(1);
  });

  it("rejects invalid definition", async () => {
    await expect(deployTeam({
      definition: { name: "", bots: {} },
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    })).rejects.toThrow("Invalid team definition");
  });

  it("throws when scaffold path is outside allowed roots", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "mecha-home-"));
    const def: TeamDef = {
      name: "bad-scaffold",
      home: homeDir,
      workspace: workspaceDir,
      bots: { a: { cwd: workspaceDir } },
      scaffold: {
        "/etc/evil/file.txt": "malicious content",
      },
    };
    await expect(deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    })).rejects.toThrow('Scaffold path "/etc/evil/file.txt" is outside allowed roots');
  });

  it("throws when spawnBot returns false", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "mecha-home-"));
    const def: TeamDef = {
      name: "fail-spawn",
      home: homeDir,
      workspace: workspaceDir,
      bots: { broken: { cwd: workspaceDir } },
    };
    await expect(deployTeam({
      definition: def,
      mechaDir,
      spawnBot: async () => false,
      grantAcl: makeGrantAcl(),
    })).rejects.toThrow('Failed to spawn bot "broken"');
  });

  it("creates bus topics and queues during deploy", async () => {
    const def = makeDef();
    def.bus = {
      topics: ["events", "logs"],
      queues: [
        { name: "tasks", maxRetries: 5 },
        { name: "alerts" },
      ],
    };

    const createdTopics: string[] = [];
    const createdQueues: Array<{ name: string; opts?: { maxRetries?: number } }> = [];

    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
      createBusTopic: (name) => { createdTopics.push(name); },
      createBusQueue: (name, opts) => { createdQueues.push({ name, opts }); },
    });

    expect(result.busTopics).toEqual(["events", "logs"]);
    expect(result.busQueues).toEqual(["tasks", "alerts"]);
    expect(createdTopics).toEqual(["events", "logs"]);
    expect(createdQueues).toEqual([
      { name: "tasks", opts: { maxRetries: 5 } },
      { name: "alerts", opts: { maxRetries: undefined } },
    ]);

    // Verify bus info is persisted in teams.json
    const teams = listTeams(mechaDir);
    expect(teams[0]!.bus).toEqual(def.bus);
  });

  it("returns empty bus arrays when no bus definition", async () => {
    const def = makeDef();
    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });
    expect(result.busTopics).toEqual([]);
    expect(result.busQueues).toEqual([]);
  });

  it("copies workflow files during deploy", async () => {
    const teamFileDir = mkdtempSync(join(tmpdir(), "mecha-teamfile-"));
    writeFileSync(join(teamFileDir, "build.yaml"), "steps:\n  - name: build\n");
    writeFileSync(join(teamFileDir, "deploy.yaml"), "steps:\n  - name: deploy\n");

    const def = makeDef();
    def.workflows = ["build.yaml", "deploy.yaml"];

    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
      teamFileDir,
    });

    expect(result.workflows).toEqual(["build.yaml", "deploy.yaml"]);
    expect(existsSync(join(mechaDir, "workflows", "build.yaml"))).toBe(true);
    expect(existsSync(join(mechaDir, "workflows", "deploy.yaml"))).toBe(true);
    expect(readFileSync(join(mechaDir, "workflows", "build.yaml"), "utf-8")).toContain("build");

    // Verify workflows are persisted in teams.json
    const teams = listTeams(mechaDir);
    expect(teams[0]!.workflows).toEqual(["build.yaml", "deploy.yaml"]);
  });

  it("throws when workflow file is missing", async () => {
    const teamFileDir = mkdtempSync(join(tmpdir(), "mecha-teamfile-"));
    const def = makeDef();
    def.workflows = ["missing.yaml"];

    await expect(deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
      teamFileDir,
    })).rejects.toThrow('Workflow file not found: missing.yaml');
  });

  it("returns empty workflows when no workflow definition", async () => {
    const def = makeDef();
    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });
    expect(result.workflows).toEqual([]);
  });

  it("scaffolds with only mechaDir as allowed root when home and workspace are absent", async () => {
    const scaffoldPath = join(mechaDir, "scaffold-test.md");
    const def: TeamDef = {
      name: "no-home-workspace",
      bots: { a: { cwd: "/x" } },
      scaffold: { [scaffoldPath]: "scaffolded content" },
    };
    const result = await deployTeam({
      definition: def,
      mechaDir,
      spawnBot: makeSpawnBot(),
      grantAcl: makeGrantAcl(),
    });
    expect(result.scaffolded).toContain(scaffoldPath);
    expect(readFileSync(scaffoldPath, "utf-8")).toBe("scaffolded content");
  });
});

describe("listTeams", () => {
  it("returns empty when no teams deployed", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-empty-"));
    expect(listTeams(dir)).toEqual([]);
  });
});

describe("unregisterTeam", () => {
  it("removes team from registry", async () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-unreg-"));
    const homeDir = mkdtempSync(join(tmpdir(), "mecha-home-"));
    await deployTeam({
      definition: { name: "test", bots: { a: { cwd: "/x" } }, home: homeDir },
      mechaDir,
      spawnBot: async () => true,
      grantAcl: () => {},
    });

    expect(unregisterTeam(mechaDir, "test")).toBe(true);
    expect(listTeams(mechaDir)).toHaveLength(0);
  });

  it("returns false for unknown team", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-unreg2-"));
    expect(unregisterTeam(dir, "nope")).toBe(false);
  });
});
