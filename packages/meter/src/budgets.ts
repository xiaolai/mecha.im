import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { BudgetConfig, BudgetLimit, CostSummary } from "./types.js";

/** Path to budgets.json */
export function budgetsPath(meterDir: string): string {
  return join(meterDir, "budgets.json");
}

/** Sanitize a budget limit object: coerce to finite positive numbers, drop invalid. */
function sanitizeLimit(raw: unknown): BudgetLimit {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const limit: BudgetLimit = {};
  if (typeof obj.dailyUsd === "number" && Number.isFinite(obj.dailyUsd) && obj.dailyUsd > 0) {
    limit.dailyUsd = obj.dailyUsd;
  }
  if (typeof obj.monthlyUsd === "number" && Number.isFinite(obj.monthlyUsd) && obj.monthlyUsd > 0) {
    limit.monthlyUsd = obj.monthlyUsd;
  }
  return limit;
}

/** Sanitize a record of budget limits. */
function sanitizeLimitMap(raw: unknown): Record<string, BudgetLimit> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, BudgetLimit> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = sanitizeLimit(value);
  }
  return result;
}

/** Read budgets from disk. Returns empty config if missing or corrupt. */
export function readBudgets(meterDir: string): BudgetConfig {
  try {
    const raw = JSON.parse(readFileSync(budgetsPath(meterDir), "utf-8")) as Partial<BudgetConfig>;
    return {
      global: sanitizeLimit(raw.global),
      byBot: sanitizeLimitMap(raw.byBot),
      byAuthProfile: sanitizeLimitMap(raw.byAuthProfile),
      byTag: sanitizeLimitMap(raw.byTag),
    };
  } catch {
    /* v8 ignore start -- missing or corrupt budgets.json */
    console.error("[mecha:meter] Failed to read budgets.json, using empty config");
    /* v8 ignore stop */
    return { global: {}, byBot: {}, byAuthProfile: {}, byTag: {} };
  }
}

/** Write budgets to disk (atomic: write tmp + rename). */
export function writeBudgets(meterDir: string, config: BudgetConfig): void {
  const path = budgetsPath(meterDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, path);
}

export interface BudgetCheckResult {
  allowed: boolean;
  /** 80% warning messages (request still allowed) */
  warnings: string[];
  /** 100% exceeded message (request blocked) */
  exceeded: string | null;
}

export interface BudgetCheckInput {
  config: BudgetConfig;
  bot: string;
  authProfile: string;
  tags: string[];
  global: { today: CostSummary; month: CostSummary };
  perBot?: { today: CostSummary; month: CostSummary };
  perAuth?: { today: CostSummary; month: CostSummary };
  perTag: Record<string, { today: CostSummary; month: CostSummary }>;
  /** Estimated cost of in-flight requests for this bot (for per-bot/auth/tag budgets). */
  pendingCostUsd?: number;
  /** Estimated cost of all in-flight requests globally (for global budget). */
  globalPendingCostUsd?: number;
}

/** Check all applicable budgets for a request */
export function checkBudgets(input: BudgetCheckInput): BudgetCheckResult {
  const { config, bot, authProfile, tags, pendingCostUsd = 0, globalPendingCostUsd } = input;
  const warnings: string[] = [];
  let exceeded: string | null = null;

  // Check global limits (use global pending cost if provided, otherwise fall back to per-bot)
  if (config.global.dailyUsd !== undefined || config.global.monthlyUsd !== undefined) {
    const globalPending = globalPendingCostUsd ?? pendingCostUsd;
    const r = checkLimit(config.global, "global", input.global.today, input.global.month, globalPending);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-bot limits
  const casaBudget = config.byBot[bot];
  if (casaBudget && input.perBot) {
    const r = checkLimit(casaBudget, `bot ${bot}`, input.perBot.today, input.perBot.month, pendingCostUsd);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-auth limits
  const authBudget = config.byAuthProfile[authProfile];
  if (authBudget && input.perAuth) {
    const r = checkLimit(authBudget, `auth ${authProfile}`, input.perAuth.today, input.perAuth.month, pendingCostUsd);
    if (r.exceeded) exceeded = r.exceeded;
    warnings.push(...r.warnings);
  }

  // Check per-tag limits
  for (const tag of tags) {
    const tagBudget = config.byTag[tag];
    const tagData = input.perTag[tag];
    if (tagBudget && tagData) {
      const r = checkLimit(tagBudget, `tag ${tag}`, tagData.today, tagData.month, pendingCostUsd);
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
  pendingCostUsd = 0,
): { warnings: string[]; exceeded: string | null } {
  const warnings: string[] = [];
  let exceeded: string | null = null;

  if (limit.dailyUsd !== undefined) {
    const effectiveCost = today.costUsd + pendingCostUsd;
    const ratio = effectiveCost / limit.dailyUsd;
    if (ratio >= 1.0) {
      exceeded = `${label} exceeded daily limit ($${limit.dailyUsd.toFixed(2)}). Current: $${effectiveCost.toFixed(2)}`;
    } else if (ratio >= 0.8) {
      warnings.push(`${label} at ${Math.round(ratio * 100)}% of daily budget ($${effectiveCost.toFixed(2)}/$${limit.dailyUsd.toFixed(2)})`);
    }
  }

  if (limit.monthlyUsd !== undefined) {
    const effectiveCost = month.costUsd + pendingCostUsd;
    const ratio = effectiveCost / limit.monthlyUsd;
    if (ratio >= 1.0) {
      exceeded = `${label} exceeded monthly limit ($${limit.monthlyUsd.toFixed(2)}). Current: $${effectiveCost.toFixed(2)}`;
    } else if (ratio >= 0.8) {
      warnings.push(`${label} at ${Math.round(ratio * 100)}% of monthly budget ($${effectiveCost.toFixed(2)}/$${limit.monthlyUsd.toFixed(2)})`);
    }
  }

  return { warnings, exceeded };
}

type BudgetTarget =
  | { type: "global" }
  | { type: "bot"; name: string }
  | { type: "auth"; name: string }
  | { type: "tag"; name: string };

/** Set a budget for a target */
export function setBudget(
  config: BudgetConfig,
  target: BudgetTarget,
  daily?: number,
  monthly?: number,
): void {
  const limit: BudgetLimit = {};
  if (daily !== undefined) limit.dailyUsd = daily;
  if (monthly !== undefined) limit.monthlyUsd = monthly;

  if (target.type === "global") {
    config.global = { ...config.global, ...limit };
  } else if (target.type === "bot") {
    config.byBot[target.name] = { ...config.byBot[target.name], ...limit };
  } else if (target.type === "auth") {
    config.byAuthProfile[target.name] = { ...config.byAuthProfile[target.name], ...limit };
  } else {
    config.byTag[target.name] = { ...config.byTag[target.name], ...limit };
  }
}

/** Remove a budget limit */
export function removeBudget(
  config: BudgetConfig,
  target: BudgetTarget,
  field: "daily" | "monthly",
): boolean {
  const key = field === "daily" ? "dailyUsd" : "monthlyUsd";
  let bucket: BudgetLimit | undefined;

  if (target.type === "global") {
    bucket = config.global;
  } else if (target.type === "bot") {
    bucket = config.byBot[target.name];
  } else if (target.type === "auth") {
    bucket = config.byAuthProfile[target.name];
  } else {
    bucket = config.byTag[target.name];
  }

  if (!bucket || bucket[key] === undefined) return false;
  delete bucket[key];
  return true;
}
