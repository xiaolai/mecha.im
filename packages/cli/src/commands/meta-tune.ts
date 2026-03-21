import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createScoreStore, analyzeBotPerformance } from "@mecha/observe";

/** Register the 'meta tune' subcommand. */
export function registerMetaTuneCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("tune")
    .description("Analyze bot quality and show tuning recommendations")
    .argument("[bot]", "Specific bot to analyze (omit for all)")
    .action(async (bot?: string) => withErrorHandler(deps, async () => {
      const scoresDir = join(deps.mechaDir, "observe", "scores");
      const scoreStore = createScoreStore(scoresDir);

      if (bot) {
        const analysis = analyzeBotPerformance(scoreStore, bot);
        if (!analysis) {
          deps.formatter.info(`No quality scores found for bot "${bot}"`);
          return;
        }
        printAnalysis(deps, analysis);
        return;
      }

      // Analyze all bots: find unique bot names from all scores
      const allScores = scoreStore.all();
      const botNames = [...new Set(
        allScores.filter((s) => s.bot).map((s) => s.bot!),
      )];

      if (botNames.length === 0) {
        deps.formatter.info("No quality scores found. Score some runs first.");
        return;
      }

      deps.formatter.info("Tuning Recommendations");
      deps.formatter.info("─".repeat(40));

      for (const name of botNames) {
        const analysis = analyzeBotPerformance(scoreStore, name);
        /* v8 ignore start -- already filtered for bots with scores */
        if (!analysis) continue;
        /* v8 ignore stop */
        printAnalysis(deps, analysis);
        deps.formatter.info("");
      }
    }));
}

function printAnalysis(
  deps: CommandDeps,
  analysis: { bot: string; trend: string; avgScore: number; recentAvg: number; totalScores: number; recommendation: string },
): void {
  deps.formatter.info(`Bot: ${analysis.bot}`);
  deps.formatter.info(`  Trend: ${analysis.trend}`);
  deps.formatter.info(`  Avg score: ${analysis.avgScore.toFixed(1)} (recent: ${analysis.recentAvg.toFixed(1)})`);
  deps.formatter.info(`  Scores: ${analysis.totalScores}`);
  deps.formatter.info(`  Recommendation: ${analysis.recommendation}`);
}
