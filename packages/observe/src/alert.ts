import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AlertRule, Alert } from "./types.js";

/** Rule-based alert engine with threshold evaluation. */
export interface AlertEngine {
  /** Add or update an alert rule. */
  addRule(rule: AlertRule): void;

  /** Remove an alert rule. */
  removeRule(id: string): boolean;

  /** List all rules. */
  rules(): AlertRule[];

  /** Evaluate a metric value against all matching rules. Returns fired alerts. */
  evaluate(metric: string, value: number): Alert[];

  /** List recently fired alerts. */
  fired(limit?: number): Alert[];
}

/**
 * Create a file-backed alert engine.
 * Rules persist to rules.json, fired alerts to alerts.jsonl.
 */
export function createAlertEngine(alertsDir: string): AlertEngine {
  mkdirSync(alertsDir, { recursive: true });
  const rulesPath = join(alertsDir, "rules.json");
  const alertsPath = join(alertsDir, "alerts.jsonl");

  function loadRules(): AlertRule[] {
    if (!existsSync(rulesPath)) return [];
    return JSON.parse(readFileSync(rulesPath, "utf-8")) as AlertRule[];
  }

  function saveRules(rules: AlertRule[]): void {
    writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + "\n");
  }

  function compare(value: number, threshold: number, comparison: AlertRule["comparison"]): boolean {
    switch (comparison) {
      case "gt": return value > threshold;
      case "lt": return value < threshold;
      case "gte": return value >= threshold;
      case "lte": return value <= threshold;
    }
  }

  return {
    addRule(rule) {
      const rules = loadRules();
      const idx = rules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) {
        rules[idx] = rule;
      } else {
        rules.push(rule);
      }
      saveRules(rules);
    },

    removeRule(id) {
      const rules = loadRules();
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rules.splice(idx, 1);
      saveRules(rules);
      return true;
    },

    rules() {
      return loadRules();
    },

    evaluate(metric, value) {
      const rules = loadRules().filter((r) => r.metric === metric);
      const alerts: Alert[] = [];
      for (const rule of rules) {
        if (compare(value, rule.threshold, rule.comparison)) {
          const alert: Alert = {
            ruleId: rule.id,
            value,
            message: rule.message,
            firedAt: new Date().toISOString(),
          };
          alerts.push(alert);
          // Persist fired alert
          const line = JSON.stringify(alert) + "\n";
          writeFileSync(alertsPath, line, { flag: "a" });
        }
      }
      return alerts;
    },

    fired(limit = 50) {
      if (!existsSync(alertsPath)) return [];
      const content = readFileSync(alertsPath, "utf-8").trim();
      if (!content) return [];
      const all = content.split("\n").map((l) => JSON.parse(l) as Alert);
      return all.slice(-limit);
    },
  };
}
