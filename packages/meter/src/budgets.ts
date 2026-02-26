import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { BudgetConfig, BudgetLimit, CostSummary } from "./types.js";

/** Path to budgets.json */
export function budgetsPath(meterDir: string): string {
  return join(meterDir, "budgets.json");
}

/** Read budgets from disk. Returns empty config if missing or corrupt. */
export function readBudgets(meterDir: string): BudgetConfig {
  try {
    return JSON.parse(readFileSync(budgetsPath(meterDir), "utf-8")) as BudgetConfig;
  } catch {
    return { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
  }
}

/** Write budgets to disk */
export function writeBudgets(meterDir: string, config: BudgetConfig): void {
  const path = budgetsPath(meterDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

export interface BudgetCheckResult {
  allowed: boolean;
  /** 80% warning messages (request still allowed) */
  warnings: string[];
  /** 100% exceeded message (request blocked) */
  exceeded: string | null;
}

/** Check all applicable budgets for a request */
export function checkBudgets(
  config: BudgetConfig,
  casa: string,
  authProfile: string,
  tags: string[],
  todayGlobal: CostSummary,
  monthGlobal: CostSummary,
  todayCasa: CostSummary | undefined,
  monthCasa: CostSummary | undefined,
  todayAuth: CostSummary | undefined,
  monthAuth: CostSummary | undefined,
  todayByTag: Record<string, CostSummary>,
): BudgetCheckResult {
  const warnings: string[] = [];
  let exceeded: string | null = null;

  // Check global limits
  if (config.global) {
    const r = checkLimit(config.global, "global", todayGlobal, monthGlobal);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-CASA limits
  /* v8 ignore start -- byCasa/byAuthProfile/byTag always initialized by readBudgets */
  const casaBudget = config.byCasa?.[casa];
  /* v8 ignore stop */
  if (casaBudget && todayCasa) {
    const r = checkLimit(casaBudget, `CASA ${casa}`, todayCasa, monthCasa ?? todayCasa);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-auth limits
  const authBudget = config.byAuthProfile?.[authProfile];
  if (authBudget && todayAuth) {
    const r = checkLimit(authBudget, `auth ${authProfile}`, todayAuth, monthAuth ?? todayAuth);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-tag limits
  for (const tag of tags) {
    const tagBudget = config.byTag?.[tag];
    const todayTag = todayByTag[tag];
    if (tagBudget && todayTag) {
      const r = checkLimit(tagBudget, `tag ${tag}`, todayTag, todayTag);
      if (r.exceeded) exceeded = r.exceeded;
      warnings.push(...r.warnings);
    }
  }

  return { allowed: exceeded === null, warnings, exceeded };
}

function checkLimit(
  limit: BudgetLimit,
  label: string,
  today: CostSummary,
  month: CostSummary,
): { warnings: string[]; exceeded: string | null } {
  const warnings: string[] = [];
  let exceeded: string | null = null;

  if (limit.dailyUsd !== undefined) {
    const ratio = today.costUsd / limit.dailyUsd;
    if (ratio >= 1.0) {
      exceeded = `${label} exceeded daily limit ($${limit.dailyUsd.toFixed(2)}). Current: $${today.costUsd.toFixed(2)}`;
    } else if (ratio >= 0.8) {
      warnings.push(`${label} at ${Math.round(ratio * 100)}% of daily budget ($${today.costUsd.toFixed(2)}/$${limit.dailyUsd.toFixed(2)})`);
    }
  }

  if (limit.monthlyUsd !== undefined) {
    const ratio = month.costUsd / limit.monthlyUsd;
    if (ratio >= 1.0) {
      exceeded = `${label} exceeded monthly limit ($${limit.monthlyUsd.toFixed(2)}). Current: $${month.costUsd.toFixed(2)}`;
    } else if (ratio >= 0.8) {
      warnings.push(`${label} at ${Math.round(ratio * 100)}% of monthly budget ($${month.costUsd.toFixed(2)}/$${limit.monthlyUsd.toFixed(2)})`);
    }
  }

  return { warnings, exceeded };
}

/** Set a budget for a CASA */
export function setBudget(
  config: BudgetConfig,
  target: { type: "global" } | { type: "casa"; name: string } | { type: "auth"; name: string } | { type: "tag"; name: string },
  daily?: number,
  monthly?: number,
): void {
  const limit: BudgetLimit = {};
  if (daily !== undefined) limit.dailyUsd = daily;
  if (monthly !== undefined) limit.monthlyUsd = monthly;

  if (target.type === "global") {
    config.global = { ...config.global, ...limit };
  } else if (target.type === "casa") {
    if (!config.byCasa) config.byCasa = {};
    config.byCasa[target.name] = { ...config.byCasa[target.name], ...limit };
  } else if (target.type === "auth") {
    if (!config.byAuthProfile) config.byAuthProfile = {};
    config.byAuthProfile[target.name] = { ...config.byAuthProfile[target.name], ...limit };
  } else {
    if (!config.byTag) config.byTag = {};
    config.byTag[target.name] = { ...config.byTag[target.name], ...limit };
  }
}

/** Remove a budget limit */
export function removeBudget(
  config: BudgetConfig,
  target: { type: "global" } | { type: "casa"; name: string } | { type: "auth"; name: string } | { type: "tag"; name: string },
  field: "daily" | "monthly",
): boolean {
  const key = field === "daily" ? "dailyUsd" : "monthlyUsd";
  let bucket: BudgetLimit | undefined;

  if (target.type === "global") {
    bucket = config.global;
  } else if (target.type === "casa") {
    bucket = config.byCasa?.[target.name];
  } else if (target.type === "auth") {
    bucket = config.byAuthProfile?.[target.name];
  } else {
    bucket = config.byTag?.[target.name];
  }

  if (!bucket || bucket[key] === undefined) return false;
  delete bucket[key];
  return true;
}
