/** Strip "claude-" prefix and trailing date for compact display */
export function shortModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/** Format USD cost */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** Format relative time (e.g. "2h ago", "5m ago", "in 3m") */
export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const ms = Date.now() - date.getTime();

  if (ms < 0) {
    const future = Math.abs(ms);
    const mins = Math.floor(future / 60_000);
    if (mins < 1) return "in <1m";
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.floor(hrs / 24)}d`;
  }

  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
