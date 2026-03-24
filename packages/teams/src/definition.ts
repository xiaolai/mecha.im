import { parseScheduleExpression } from "@mecha/core";
import { z } from "zod";
import type { TeamDef } from "./types.js";

/** Zod schema for TeamBotDef */
const TeamBotDefSchema = z.object({
  cwd: z.string(),
  model: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expose: z.array(z.string()).optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  maxBudgetUsd: z.number().optional(),
  sandboxMode: z.enum(["auto", "off", "require"]).optional(),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
});

/** Zod schema for TeamAclDef */
const TeamAclDefSchema = z.object({
  source: z.string(),
  targets: z.array(z.string()),
  capabilities: z.array(z.string()),
});

/** Zod schema for TeamDef */
const TeamDefSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().optional(),
  home: z.string().optional(),
  workspace: z.string().optional(),
  bots: z.record(z.string(), TeamBotDefSchema).default({}),
  acl: z.array(TeamAclDefSchema).optional(),
  scaffold: z.record(z.string(), z.string()).optional(),
  bus: z.object({
    topics: z.array(z.string()).optional(),
    queues: z.array(z.object({
      name: z.string(),
      maxRetries: z.number().optional(),
    })).optional(),
  }).optional(),
  workflows: z.array(z.string()).optional(),
  schedules: z.array(z.object({
    bot: z.string(),
    id: z.string(),
    every: z.string(),
    prompt: z.string(),
  })).optional(),
});

/** Validate a team definition. Returns list of errors (empty = valid). */
export function validateTeamDef(def: TeamDef): string[] {
  const errors: string[] = [];

  if (!def.name || typeof def.name !== "string") {
    errors.push("name is required and must be a string");
  }

  if (!def.bots || typeof def.bots !== "object" || Object.keys(def.bots).length === 0) {
    errors.push("at least one bot is required");
  }

  const botNames = new Set(Object.keys(def.bots ?? {}));

  for (const [name, bot] of Object.entries(def.bots ?? {})) {
    if (!bot.cwd) {
      errors.push(`bot "${name}" requires a cwd`);
    }
  }

  // Validate ACL references
  for (const rule of def.acl ?? []) {
    if (!rule || typeof rule !== "object") {
      errors.push("ACL rule must be an object with source, targets, capabilities");
      continue;
    }
    if (typeof rule.source !== "string") {
      errors.push("ACL rule source must be a string");
      continue;
    }
    if (!Array.isArray(rule.targets)) {
      errors.push(`ACL rule for source "${rule.source}" must have a targets array`);
      continue;
    }
    if (!botNames.has(rule.source) && rule.source !== "*") {
      errors.push(`ACL source "${rule.source}" is not a defined bot`);
    }
    for (const target of rule.targets) {
      if (typeof target !== "string") {
        errors.push("ACL target must be a string");
        continue;
      }
      if (!botNames.has(target) && target !== "*") {
        errors.push(`ACL target "${target}" is not a defined bot`);
      }
    }
  }

  // Validate schedules
  for (const sched of def.schedules ?? []) {
    if (!botNames.has(sched.bot)) {
      errors.push(`Schedule "${sched.id}" references unknown bot "${sched.bot}"`);
    }
    if (!parseScheduleExpression(sched.every)) {
      errors.push(`Schedule "${sched.id}" has invalid expression "${sched.every}"`);
    }
  }

  return errors;
}

/** Parse a team definition from a JSON object (YAML parsing is done by the caller). */
export function parseTeamDef(raw: unknown): TeamDef {
  if (!raw || typeof raw !== "object") {
    throw new Error("Team definition must be an object");
  }
  const result = TeamDefSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid team definition: ${issues.join("; ")}`);
  }
  return result.data as TeamDef;
}
