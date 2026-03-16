/**
 * Extract a text snippet centered around a search needle with surrounding context.
 * Re-exported from session-history for testability in the dashboard test suite.
 */
export function extractSnippet(text: string, needle: string, contextChars = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx === -1) return text.slice(0, contextChars * 2);
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + needle.length + contextChars);
  let snippet = text.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}
