import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import type { TeamDef, DeployResult, DeployedTeam } from "./types.js";
import { validateTeamDef } from "./definition.js";

/** Scaffold .claude/ directories from template. Validates paths stay within allowed roots. */
function scaffoldFiles(scaffold: Record<string, string>, allowedRoots: string[]): string[] {
  const created: string[] = [];
  for (const [rawPath, content] of Object.entries(scaffold)) {
    const resolved = resolve(rawPath);
    const inBounds = allowedRoots.some((root) => resolved.startsWith(resolve(root) + "/") || resolved === resolve(root));
    if (!inBounds) {
      throw new Error(`Scaffold path "${rawPath}" is outside allowed roots`);
    }
    mkdirSync(dirname(resolved), { recursive: true });
    if (!existsSync(resolved)) {
      writeFileSync(resolved, content, "utf-8");
      created.push(resolved);
    }
  }
  return created;
}

/** Load deployed teams registry. */
function loadTeams(mechaDir: string): DeployedTeam[] {
  const path = join(mechaDir, "teams.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as DeployedTeam[];
}

/** Save deployed teams registry. */
function saveTeams(mechaDir: string, teams: DeployedTeam[]): void {
  writeFileSync(join(mechaDir, "teams.json"), JSON.stringify(teams, null, 2) + "\n");
}

/** Options for deploying a team. */
export interface DeployOpts {
  /** The team definition. */
  definition: TeamDef;
  /** The mecha directory (~/.mecha). */
  mechaDir: string;
  /** Callback to spawn a bot. Returns true on success. */
  spawnBot: (name: string, opts: {
    cwd: string;
    home?: string;
    model?: string;
    tags?: string[];
    expose?: string[];
    effort?: string;
    maxBudgetUsd?: number;
    sandboxMode?: string;
    systemPrompt?: string;
    appendSystemPrompt?: string;
  }) => Promise<boolean>;
  /** Callback to grant ACL. */
  grantAcl: (source: string, target: string, capabilities: string[]) => void;
  /** Callback to create a bus topic. */
  createBusTopic?: (name: string) => void;
  /** Callback to create a bus queue. */
  createBusQueue?: (name: string, opts?: { maxRetries?: number }) => void;
  /** Directory containing the team definition file (for resolving relative workflow paths). */
  teamFileDir?: string;
  /** Callback to add a schedule to a bot. */
  addSchedule?: (bot: string, schedule: { id: string; every: string; prompt: string }) => Promise<void>;
}

/**
 * Deploy a team: scaffold directories, spawn bots, configure ACL.
 * Returns a summary of what was created.
 */
export async function deployTeam(opts: DeployOpts): Promise<DeployResult> {
  const { definition, mechaDir } = opts;

  const errors = validateTeamDef(definition);
  if (errors.length > 0) {
    throw new Error(`Invalid team definition: ${errors.join("; ")}`);
  }

  // Scaffold .claude/ directories (restricted to workspace + home roots)
  const allowedRoots = [
    ...(definition.workspace ? [definition.workspace] : []),
    ...(definition.home ? [definition.home] : []),
    mechaDir,
  ];
  const scaffolded = definition.scaffold
    ? scaffoldFiles(definition.scaffold, allowedRoots)
    : [];

  // Create shared HOME if specified
  if (definition.home) {
    mkdirSync(join(definition.home, ".claude"), { recursive: true });
  }

  // Spawn bots
  const botNames: string[] = [];
  for (const [name, bot] of Object.entries(definition.bots)) {
    const ok = await opts.spawnBot(name, {
      cwd: bot.cwd,
      home: definition.home,
      model: bot.model,
      tags: bot.tags,
      expose: bot.expose,
      effort: bot.effort,
      maxBudgetUsd: bot.maxBudgetUsd,
      sandboxMode: bot.sandboxMode,
      systemPrompt: bot.systemPrompt,
      appendSystemPrompt: bot.appendSystemPrompt,
    });
    if (!ok) {
      throw new Error(`Failed to spawn bot "${name}"`);
    }
    botNames.push(name);
  }

  // Configure ACL
  let aclRules = 0;
  for (const rule of definition.acl ?? []) {
    for (const target of rule.targets) {
      opts.grantAcl(rule.source, target, rule.capabilities);
      aclRules++;
    }
  }

  // Create bus topics and queues
  const busTopics: string[] = [];
  const busQueues: string[] = [];
  if (definition.bus?.topics && opts.createBusTopic) {
    for (const name of definition.bus.topics) {
      opts.createBusTopic(name);
      busTopics.push(name);
    }
  }
  if (definition.bus?.queues && opts.createBusQueue) {
    for (const q of definition.bus.queues) {
      opts.createBusQueue(q.name, { maxRetries: q.maxRetries });
      busQueues.push(q.name);
    }
  }

  // Copy workflow definitions
  const copiedWorkflows: string[] = [];
  if (definition.workflows && opts.teamFileDir) {
    const workflowsDir = join(mechaDir, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    for (const relPath of definition.workflows) {
      const src = resolve(opts.teamFileDir, relPath);
      if (!existsSync(src)) {
        throw new Error(`Workflow file not found: ${relPath}`);
      }
      const dest = join(workflowsDir, basename(relPath));
      copyFileSync(src, dest);
      copiedWorkflows.push(basename(relPath));
    }
  }

  // Register schedules on bots
  let schedulesCount = 0;
  if (definition.schedules && opts.addSchedule) {
    for (const sched of definition.schedules) {
      await opts.addSchedule(sched.bot, {
        id: sched.id,
        every: sched.every,
        prompt: sched.prompt,
      });
      schedulesCount++;
    }
  }

  // Register deployed team
  const teams = loadTeams(mechaDir);
  const existing = teams.findIndex((t) => t.name === definition.name);
  const entry: DeployedTeam = {
    name: definition.name,
    home: definition.home,
    workspace: definition.workspace,
    bots: botNames,
    deployedAt: new Date().toISOString(),
    bus: definition.bus,
    workflows: copiedWorkflows.length > 0 ? copiedWorkflows : undefined,
    schedules: definition.schedules,
  };
  if (existing >= 0) {
    teams[existing] = entry;
  } else {
    teams.push(entry);
  }
  saveTeams(mechaDir, teams);

  return {
    team: definition.name,
    bots: botNames,
    aclRules,
    scaffolded,
    busTopics,
    busQueues,
    workflows: copiedWorkflows,
    schedules: schedulesCount,
  };
}

/** List deployed teams. */
export function listTeams(mechaDir: string): DeployedTeam[] {
  return loadTeams(mechaDir);
}

/** Remove a team from the registry (does NOT stop/remove bots — caller handles that). */
export function unregisterTeam(mechaDir: string, name: string): boolean {
  const teams = loadTeams(mechaDir);
  const idx = teams.findIndex((t) => t.name === name);
  if (idx === -1) return false;
  teams.splice(idx, 1);
  saveTeams(mechaDir, teams);
  return true;
}
