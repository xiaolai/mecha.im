import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function sanitizeMarkdown(text: string): string {
  const raw = marked.parse(text) as string;
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["iframe", "object", "embed", "form", "img"],
    FORBID_ATTR: ["srcset"],
    ALLOW_DATA_ATTR: false,
  } as Parameters<typeof DOMPurify.sanitize>[1]);
}
