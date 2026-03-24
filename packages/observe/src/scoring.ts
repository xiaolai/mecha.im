import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { QualityScore } from "./types.js";

/** Parse JSONL file into array of objects. */
function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}

/** Persistent store for quality scores. */
export interface ScoreStore {
  /** Record a quality score. */
  record(score: QualityScore): void;

  /** Get all scores for a run. */
  forRun(runId: string): QualityScore[];

  /** Get all scores for a bot (across all runs). */
  forBot(bot: string): QualityScore[];

  /** Get average score for a bot. Returns undefined if no scores. */
  avgForBot(bot: string): number | undefined;

  /** Get average score for a workflow. Returns undefined if no scores match. */
  avgForWorkflow(workflow: string): number | undefined;

  /** Get all scores. */
  all(): QualityScore[];
}

/**
 * Create a file-backed quality score store.
 * Scores are appended to a JSONL file.
 */
export function createScoreStore(scoresDir: string): ScoreStore {
  mkdirSync(scoresDir, { recursive: true });
  const scoresPath = join(scoresDir, "scores.jsonl");

  return {
    record(score) {
      const line = JSON.stringify(score) + "\n";
      writeFileSync(scoresPath, line, { flag: "a" });
    },

    forRun(runId) {
      return readJsonl<QualityScore>(scoresPath).filter((s) => s.runId === runId);
    },

    forBot(bot) {
      return readJsonl<QualityScore>(scoresPath).filter((s) => s.bot === bot);
    },

    avgForBot(bot) {
      const scores = this.forBot(bot);
      if (scores.length === 0) return undefined;
      return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
    },

    avgForWorkflow(workflow) {
      const all = readJsonl<QualityScore>(scoresPath);
      // Filter by workflow field; scores without a workflow field are excluded
      const matched = all.filter((s) => s.workflow === workflow && !s.stepId);
      if (matched.length === 0) return undefined;
      return matched.reduce((sum, s) => sum + s.score, 0) / matched.length;
    },

    all() {
      return readJsonl<QualityScore>(scoresPath);
    },
  };
}
