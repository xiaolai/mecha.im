import { parseScheduleExpression } from "@mecha/core";
import type { TeamDef } from "./types.js";

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
  const obj = raw as Record<string, unknown>;
  return {
    name: obj.name as string,
    description: obj.description as string | undefined,
    version: obj.version as number | undefined,
    home: obj.home as string | undefined,
    workspace: obj.workspace as string | undefined,
    bots: (obj.bots ?? {}) as TeamDef["bots"],
    acl: obj.acl as TeamDef["acl"],
    scaffold: obj.scaffold as TeamDef["scaffold"],
    bus: obj.bus as TeamDef["bus"],
    workflows: obj.workflows as TeamDef["workflows"],
    schedules: obj.schedules as TeamDef["schedules"],
  };
}
