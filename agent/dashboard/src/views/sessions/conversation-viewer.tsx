import { useState, useEffect, useRef, useMemo } from "react";
import { botFetch } from "../../lib/api";
import { sanitizeMarkdown } from "../../lib/sanitize";

interface ConversationMessage {
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  toolResultContent?: string;
  model?: string;
  thinkingContent?: string;
  tokensIn?: number;
  tokensOut?: number;
}

interface SessionDetail {
  id: string;
  messages: ConversationMessage[];
  totalCostUsd: number;
  model: string;
}

// --- Markdown renderer with DOMPurify sanitization ---

function MarkdownContent({ text, variant }: { text: string; variant?: "user" | "assistant" }) {
  const html = useMemo(() => sanitizeMarkdown(text), [text]);
  return (
    <div
      className={`prose prose-sm max-w-none
        ${variant === "user" ? "prose-headings:text-msg-user-foreground prose-p:text-msg-user-foreground prose-li:text-msg-user-foreground prose-strong:text-msg-user-foreground prose-a:text-msg-user-foreground" : "dark:prose-invert prose-headings:text-foreground"}
        prose-pre:bg-code-bg prose-pre:border prose-pre:border-code-border prose-pre:text-xs
        prose-code:bg-code-bg prose-code:text-code-text prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
        prose-table:border-collapse prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1
        prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1
        prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground
        prose-hr:border-border`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// --- Tool card ---

function ToolCard({ msg, result }: { msg: ConversationMessage; result?: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false);

  const toolLabel = formatToolLabel(msg.toolName ?? "tool", msg.toolInput);

  return (
    <div className="my-1.5 border border-msg-tool-border rounded-md bg-msg-tool">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs hover:bg-accent/50 transition-colors rounded-md"
      >
        <span className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        <span className="text-primary font-mono">{msg.toolName}</span>
        <span className="text-muted-foreground truncate flex-1">{toolLabel}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Input:</div>
            <pre className="text-xs bg-code-bg text-code-text border border-code-border rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto">
              {typeof msg.toolInput === "string"
                ? msg.toolInput
                : JSON.stringify(msg.toolInput, null, 2)}
            </pre>
          </div>
          {result && result.content && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Output:</div>
              <pre className="text-xs bg-code-bg text-code-text border border-code-border rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto">
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatToolLabel(toolName: string, input: unknown): string {
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

// --- Thinking block ---

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="italic">thinking...</span>
      </button>
      {expanded && (
        <pre className="text-xs text-muted-foreground bg-muted rounded-md p-2 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

// --- Main component ---

interface Props {
  sessionId: string;
  className?: string;
}

export default function ConversationViewer({ sessionId, className }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    botFetch(`/api/sessions/${sessionId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data || !Array.isArray(data.messages)) throw new Error("Invalid session data");
        setDetail(data as SessionDetail);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [detail, loading]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground ${className ?? ""}`}>
        Loading conversation...
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center text-destructive ${className ?? ""}`}>
        Error: {error}
      </div>
    );
  }

  if (!detail || detail.messages.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground ${className ?? ""}`}>
        No messages in this session
      </div>
    );
  }

  // Build tool result lookup: toolUseId → message
  const toolResults = new Map<string, ConversationMessage>();
  for (const msg of detail.messages) {
    if (msg.role === "tool_result" && msg.toolUseId) {
      toolResults.set(msg.toolUseId, msg);
    }
  }

  return (
    <div className={`overflow-y-auto overflow-x-hidden scrollbar-thin ${className ?? ""}`}>
      {/* Header */}
      <div className="sticky top-0 bg-background/90 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground z-10">
        <span className="font-mono">{detail.id.slice(0, 8)}</span>
        <span className="opacity-30">·</span>
        <span>{detail.model}</span>
        <span className="opacity-30">·</span>
        <span>{detail.messages.filter((m) => m.role === "user" || m.role === "assistant").length} messages</span>
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3">
        {detail.messages.map((msg, i) => {
          // Skip tool_result — shown inside ToolCard
          if (msg.role === "tool_result") return null;

          const key = msg.toolUseId ?? `${msg.role}-${msg.timestamp}-${i}`;

          if (msg.role === "user") {
            return (
              <div key={key} className="ml-12">
                <div className="bg-msg-user text-msg-user-foreground rounded-lg p-3 text-sm">
                  <MarkdownContent text={msg.content} variant="user" />
                </div>
              </div>
            );
          }

          if (msg.role === "tool_use") {
            const result = msg.toolUseId ? toolResults.get(msg.toolUseId) : undefined;
            return <ToolCard key={key} msg={msg} result={result} />;
          }

          if (msg.role === "assistant") {
            return (
              <div key={key} className="mr-12">
                {msg.thinkingContent && <ThinkingBlock content={msg.thinkingContent} />}
                <div className="bg-msg-assistant text-msg-assistant-foreground rounded-lg p-3 text-sm">
                  <MarkdownContent text={msg.content} variant="assistant" />
                </div>
                {msg.tokensIn != null && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {msg.tokensIn?.toLocaleString()} in / {msg.tokensOut?.toLocaleString()} out
                  </div>
                )}
              </div>
            );
          }

          return null;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
