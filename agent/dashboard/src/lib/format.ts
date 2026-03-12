export function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!iso || isNaN(ts)) return "unknown";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function modelShort(model: string): string {
  if (!model) return "unknown";
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model.split("-").pop() ?? model;
}

export function formatToolLabel(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return String(obj.file_path ?? "");
    case "Bash":
      return String(obj.command ?? "").slice(0, 80);
    case "Grep":
    case "Glob":
      return String(obj.pattern ?? "");
    case "WebSearch":
      return String(obj.query ?? "");
    default:
      return Object.keys(obj).slice(0, 2).join(", ");
  }
}
