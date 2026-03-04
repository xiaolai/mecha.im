import { useState, useRef, useEffect } from "react";
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

function UserBubble({ event }: { event: TranscriptEvent }) {
  const text = extractText(event.message);
  if (!text) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg bg-primary/10 p-3">
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ event }: { event: TranscriptEvent }) {
  const text = extractText(event.message);
  if (!text) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg border border-border bg-card p-3">
        <p className="whitespace-pre-wrap text-sm">{text}</p>
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
  switch (event.type) {
    case "user":
      return <UserBubble key={index} event={event} />;
    case "assistant":
      return <AssistantBubble key={index} event={event} />;
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
