export const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "Every minute", cron: "* * * * *" },
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { label: "Weekly (Monday)", cron: "0 0 * * 1" },
];

export function cronToHuman(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every minute";
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return `Every ${min.slice(2)} minutes`;
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*")
    return `Every ${hour.slice(2)} hours`;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*") return "Daily at midnight";
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "1-5" && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `Weekdays at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && /^\d+$/.test(dow) && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[parseInt(dow)] ?? `Day ${dow}`} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}

export function timeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000);
    const m = Math.floor((diff % 3600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(diff / 86400_000)}d`;
}
