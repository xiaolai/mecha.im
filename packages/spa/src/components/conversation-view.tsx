import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

interface ConversationViewProps {
  events: TranscriptEvent[];
}

type ViewMode = "messages" | "full";

/** Strip Claude Code XML control tags from text for clean display.
 *  - System noise tags: remove entirely (tag + content)
 *  - User-facing tags: unwrap (remove tags, keep content)
 */
const NOISE_TAGS = "system-reminder|local-command-caveat|antml:[a-z_]+";
const NOISE_RE = new RegExp(`<(${NOISE_TAGS})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:${NOISE_TAGS})>`, "g");
const UNWRAP_TAGS = "command-name|command-message|command-args|local-command-stdout";
const UNWRAP_RE = new RegExp(`<\\/?(${UNWRAP_TAGS})(?:\\s[^>]*)?>`, "g");

function stripXmlTags(text: string): string {
  // First: remove system noise tags entirely (tag + content)
  let cleaned = text.replace(NOISE_RE, "");
  // Then: unwrap user-facing tags (keep content, remove tags)
  cleaned = cleaned.replace(UNWRAP_RE, "");
  // Collapse multiple blank lines left after stripping
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/** Extract displayable text from a message field (string, content blocks array, or {role, content} object). */
function extractText(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b?.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  if (message && typeof message === "object" && "content" in message) {
    return extractText((message as { content: unknown }).content);
  }
  return "";
}

/** Markdown renderer with tailwind prose-like styling via component overrides. */
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: c }) => <p className="mb-2 last:mb-0">{c}</p>,
        strong: ({ children: c }) => <strong className="font-semibold">{c}</strong>,
        em: ({ children: c }) => <em>{c}</em>,
        code: ({ className, children: c, ...props }) => {
          // Inline code vs code block — check if className has language-*
          if (className) {
            return (
              <code className={cn("block overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs", className)} {...props}>
                {c}
              </code>
            );
          }
          return (
            <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-xs" {...props}>
              {c}
            </code>
          );
        },
        pre: ({ children: c }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">{c}</pre>,
        ul: ({ children: c }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{c}</ul>,
        ol: ({ children: c }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{c}</ol>,
        li: ({ children: c }) => <li>{c}</li>,
        a: ({ href, children: c }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
            {c}
          </a>
        ),
        blockquote: ({ children: c }) => <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{c}</blockquote>,
        h1: ({ children: c }) => <h1 className="mb-2 text-base font-semibold">{c}</h1>,
        h2: ({ children: c }) => <h2 className="mb-2 text-sm font-semibold">{c}</h2>,
        h3: ({ children: c }) => <h3 className="mb-1 text-sm font-medium">{c}</h3>,
        table: ({ children: c }) => <div className="my-2 overflow-x-auto"><table className="min-w-full text-xs">{c}</table></div>,
        th: ({ children: c }) => <th className="border border-border px-2 py-1 text-left font-medium bg-muted/50">{c}</th>,
        td: ({ children: c }) => <td className="border border-border px-2 py-1">{c}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function UserBubble({ event, clean }: { event: TranscriptEvent; clean: boolean }) {
  const raw = extractText(event.message);
  if (!raw) return null;
  const text = clean ? stripXmlTags(raw) : raw;
  if (!text) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg bg-primary/10 p-3">
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ event, clean }: { event: TranscriptEvent; clean: boolean }) {
  const raw = extractText(event.message);
  if (!raw) return null;
  const text = clean ? stripXmlTags(raw) : raw;
  if (!text) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg border border-border bg-card p-3 text-sm">
        {clean ? <Markdown>{text}</Markdown> : <p className="whitespace-pre-wrap">{text}</p>}
      </div>
    </div>
  );
}

function ToolUseSummary({ event }: { event: TranscriptEvent }) {
  const name = typeof event.name === "string" ? event.name : "unknown tool";
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-2">
      <ChevronRightIcon className="size-3" />
      <span className="font-mono">{name}</span>
    </div>
  );
}

function ToolUseExpanded({ event }: { event: TranscriptEvent }) {
  const name = typeof event.name === "string" ? event.name : "unknown tool";
  const input = event.input;
  return (
    <div className="space-y-1 pl-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChevronRightIcon className="size-3" />
        <span className="font-mono">{name}</span>
      </div>
      {input !== undefined && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
          {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ event }: { event: TranscriptEvent }) {
  const [open, setOpen] = useState(false);
  const content = extractText(event.content) || (event.content != null ? JSON.stringify(event.content, null, 2) : "");
  if (!content) return null;
  return (
    <div className="pl-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        <span>Result</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
          {content}
        </pre>
      )}
    </div>
  );
}

function GenericEvent({ event }: { event: TranscriptEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pl-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        <span className="font-mono">{event.type}</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function renderEvent(event: TranscriptEvent, mode: ViewMode, index: number) {
  const clean = mode === "messages";
  switch (event.type) {
    case "user":
      return <UserBubble key={index} event={event} clean={clean} />;
    case "assistant":
      return <AssistantBubble key={index} event={event} clean={clean} />;
    case "tool_use":
      return mode === "full"
        ? <ToolUseExpanded key={index} event={event} />
        : <ToolUseSummary key={index} event={event} />;
    case "tool_result":
      return mode === "full" ? <ToolResultBlock key={index} event={event} /> : null;
    default:
      return mode === "full" ? <GenericEvent key={index} event={event} /> : null;
  }
}

/** Renders a session transcript as chat bubbles with messages/full toggle. */
export function ConversationView({ events }: ConversationViewProps) {
  const [mode, setMode] = useState<ViewMode>("messages");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No messages yet.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Filter toggle */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        <button
          onClick={() => setMode("messages")}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            mode === "messages"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          Messages
        </button>
        <button
          onClick={() => setMode("full")}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            mode === "full"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          Full transcript
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {events.map((event, i) => renderEvent(event, mode, i))}
      </div>
    </div>
  );
}
