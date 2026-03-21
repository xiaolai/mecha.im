import type { ScoreStore } from "./scoring.js";

/** Trend direction for a bot's quality over time. */
export type Trend = "improving" | "declining" | "stable";

/** Analysis result for a bot's performance. */
export interface PerformanceAnalysis {
  bot: string;
  trend: Trend;
  avgScore: number;
  recentAvg: number;
  olderAvg: number;
  totalScores: number;
  recommendation: string;
}

/**
 * Analyze a bot's quality scores to detect trend direction.
 *
 * Splits scores into two halves (older vs recent) and compares averages.
 * A difference of >= 0.5 points triggers improving/declining; otherwise stable.
 *
 * Returns null if the bot has no scores.
 */
export function analyzeBotPerformance(
  scoreStore: ScoreStore,
  botName: string,
): PerformanceAnalysis | null {
  const scores = scoreStore.forBot(botName);
  if (scores.length === 0) return null;

  const values = scores.map((s) => s.score);
  const avgScore = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Need at least 2 scores to compute a trend
  if (values.length < 2) {
    return {
      bot: botName,
      trend: "stable",
      avgScore,
      recentAvg: avgScore,
      olderAvg: avgScore,
      totalScores: values.length,
      recommendation: `Only ${values.length} score recorded for ${botName}. Collect more data to detect trends.`,
    };
  }

  // Split into two halves: older (first half) and recent (second half)
  const mid = Math.floor(values.length / 2);
  const olderHalf = values.slice(0, mid);
  const recentHalf = values.slice(mid);

  const olderAvg = olderHalf.reduce((sum, v) => sum + v, 0) / olderHalf.length;
  const recentAvg = recentHalf.reduce((sum, v) => sum + v, 0) / recentHalf.length;

  const diff = recentAvg - olderAvg;
  const threshold = 0.5;

  let trend: Trend;
  if (diff >= threshold) {
    trend = "improving";
  } else if (diff <= -threshold) {
    trend = "declining";
  } else {
    trend = "stable";
  }

  const recommendation = suggestPromptChange({
    bot: botName,
    trend,
    avgScore,
    recentAvg,
    olderAvg,
    totalScores: values.length,
  });

  return {
    bot: botName,
    trend,
    avgScore,
    recentAvg,
    olderAvg,
    totalScores: values.length,
    recommendation,
  };
}

/**
 * Suggest a prompt change based on performance analysis.
 */
export function suggestPromptChange(analysis: {
  bot: string;
  trend: Trend;
  avgScore: number;
  recentAvg: number;
  olderAvg: number;
  totalScores: number;
}): string {
  const { bot, trend, avgScore, recentAvg, olderAvg, totalScores } = analysis;

  if (totalScores < 2) {
    return `Only ${totalScores} score recorded for ${bot}. Collect more data to detect trends.`;
  }

  switch (trend) {
    case "declining":
      return (
        `Quality dropped from ${olderAvg.toFixed(1)} to ${recentAvg.toFixed(1)} ` +
        `over ${totalScores} sessions. ` +
        `Consider reviewing system prompt for ${bot}.`
      );
    case "improving":
      return (
        `Quality improved from ${olderAvg.toFixed(1)} to ${recentAvg.toFixed(1)} ` +
        `over ${totalScores} sessions. ` +
        `Current approach for ${bot} is working well.`
      );
    case "stable":
      return (
        `Quality is stable at ${avgScore.toFixed(1)} ` +
        `over ${totalScores} sessions. ` +
        (avgScore < 3
          ? `Average is below 3.0 for ${bot}. Consider significant prompt changes.`
          : `No immediate changes needed for ${bot}.`)
      );
  }
}
