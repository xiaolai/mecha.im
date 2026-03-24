/** Bot definition within a team template. */
export interface TeamBotDef {
  cwd: string;
  model?: string;
  tags?: string[];
  expose?: string[];
  effort?: "low" | "medium" | "high";
  maxBudgetUsd?: number;
  sandboxMode?: "auto" | "off" | "require";
  systemPrompt?: string;
  appendSystemPrompt?: string;
}

/** ACL rule within a team template. */
export interface TeamAclDef {
  source: string;
  targets: string[];
  capabilities: string[];  // validated against Capability at deploy time
}

/** Scaffold entry: path → content. */
export type ScaffoldDef = Record<string, string>;

/** Team template definition (parsed from YAML or JSON). */
export interface TeamDef {
  name: string;
  description?: string;
  version?: number;
  home?: string;
  workspace?: string;
  bots: Record<string, TeamBotDef>;
  acl?: TeamAclDef[];
  scaffold?: ScaffoldDef;
  bus?: {
    topics?: string[];
    queues?: { name: string; maxRetries?: number }[];
  };
  workflows?: string[];  // paths relative to team definition file
  schedules?: Array<{
    bot: string;    // must reference a bot in the team
    id: string;
    every: string;  // interval or cron expression
    prompt: string;
  }>;
}

/** Result of deploying a team. */
export interface DeployResult {
  team: string;
  bots: string[];
  aclRules: number;
  scaffolded: string[];
  busTopics: string[];
  busQueues: string[];
  workflows: string[];
  schedules: number;
}

/** Deployed team metadata (persisted to teams.json). */
export interface DeployedTeam {
  name: string;
  home?: string;
  workspace?: string;
  bots: string[];
  deployedAt: string;
  bus?: TeamDef["bus"];
  workflows?: string[];
  schedules?: TeamDef["schedules"];
}
