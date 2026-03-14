import type { JLine, JContentBlock } from "./session-history-types.js";

export function normalizeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export const SKIP_TYPES = new Set(["queue-operation", "last-prompt", "file-history-snapshot", "progress", "system"]);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isToolResultLine(line: JLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((b) => b.type === "tool_result");
}

// Tags injected by the CLI that are not real user content
const CLI_TAG_RE = /^<(?:command-name|command-message|local-command-caveat|local-command-stdout|local-command-stderr|system-reminder|task-notification)/;

export function collectMetaUuids(lines: JLine[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.isMeta && line.uuid) ids.add(line.uuid);
  }
  return ids;
}

export function isCliContent(content: string | JContentBlock[]): boolean {
  if (typeof content === "string") return CLI_TAG_RE.test(content.trim());
  if (Array.isArray(content) && content[0]?.type === "text") {
    return CLI_TAG_RE.test((content[0].text ?? "").trim());
  }
  return false;
}

export function isRealUserMessage(line: JLine, metaUuids?: Set<string>): boolean {
  if (line.type !== "user") return false;
  if (line.isMeta) return false;
  // Children of meta lines are CLI system messages (slash commands, errors)
  if (metaUuids && line.parentUuid && metaUuids.has(line.parentUuid)) return false;
  const content = line.message?.content;
  if (content === undefined || content === null) return false;
  if (isCliContent(content)) return false;
  // String content (PTY/terminal sessions)
  if (typeof content === "string") return content.trim().length > 0;
  // Array content (SDK sessions) — must have a text block (not just tool_result)
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((b) => b.type === "text");
}

export function extractTextFromContent(content: JContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

export function extractToolResultText(content: JContentBlock[]): string {
  for (const block of content) {
    if (block.type === "tool_result") {
      if (typeof block.content === "string") return block.content;
      if (Array.isArray(block.content)) {
        return block.content
          .filter((b) => typeof b === "object" && b.type === "text" && b.text)
          .map((b) => (b as JContentBlock).text!)
          .join("\n");
      }
    }
  }
  return "";
}

export function parseLines(raw: string): JLine[] {
  const lines: JLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return lines;
}

export function extractSnippet(text: string, needle: string, contextChars = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return text.slice(0, contextChars * 2);
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + needle.length + contextChars);
  let snippet = text.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}
