import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { botFetch } from "../../lib/api";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

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

function MarkdownContent({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);
  return (
    <div
      className="prose prose-invert prose-sm max-w-none
        prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-pre:text-xs
        prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
        prose-table:border-collapse prose-th:border prose-th:border-gray-600 prose-th:px-2 prose-th:py-1
        prose-td:border prose-td:border-gray-700 prose-td:px-2 prose-td:py-1
        prose-a:text-blue-400 prose-headings:text-gray-200
        prose-blockquote:border-l-gray-600 prose-blockquote:text-gray-400
        prose-hr:border-gray-700"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// --- Tool card ---

function ToolCard({ msg, result }: { msg: ConversationMessage; result?: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false);

  const toolLabel = formatToolLabel(msg.toolName ?? "tool", msg.toolInput);

  return (
    <div className="my-1.5 border border-gray-700 rounded bg-gray-800/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs hover:bg-gray-800/60"
      >
        <span className="text-gray-500">{expanded ? "▼" : "▶"}</span>
        <span className="text-blue-400 font-mono">{msg.toolName}</span>
        <span className="text-gray-500 truncate flex-1">{toolLabel}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">Input:</div>
            <pre className="text-xs bg-gray-900 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto">
              {typeof msg.toolInput === "string"
                ? msg.toolInput
                : JSON.stringify(msg.toolInput, null, 2)}
            </pre>
          </div>
          {result && result.content && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Output:</div>
              <pre className="text-xs bg-gray-900 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto">
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
        className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="italic">thinking...</span>
      </button>
      {expanded && (
        <pre className="text-xs text-gray-500 bg-gray-900/50 rounded p-2 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">
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
    botFetch(`/api/sessions/${sessionId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.messages)) throw new Error("Invalid session data");
        setDetail(data as SessionDetail);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [detail, loading]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center text-gray-500 ${className ?? ""}`}>
        Loading conversation...
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center text-red-400 ${className ?? ""}`}>
        Error: {error}
      </div>
    );
  }

  if (!detail || detail.messages.length === 0) {
    return (
      <div className={`flex items-center justify-center text-gray-500 ${className ?? ""}`}>
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
    <div className={`overflow-y-auto overflow-x-hidden ${className ?? ""}`}>
      {/* Header */}
      <div className="sticky top-0 bg-gray-900/90 backdrop-blur border-b border-gray-800 px-4 py-2 flex items-center gap-3 text-xs text-gray-500 z-10">
        <span className="font-mono">{detail.id.slice(0, 8)}</span>
        <span className="text-gray-700">·</span>
        <span>{detail.model}</span>
        <span className="text-gray-700">·</span>
        <span>{detail.messages.filter((m) => m.role === "user" || m.role === "assistant").length} messages</span>
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3">
        {detail.messages.map((msg, i) => {
          // Skip tool_result — shown inside ToolCard
          if (msg.role === "tool_result") return null;

          if (msg.role === "user") {
            return (
              <div key={i} className="ml-12">
                <div className="bg-blue-900/30 rounded-lg p-3 text-sm">
                  <MarkdownContent text={msg.content} />
                </div>
              </div>
            );
          }

          if (msg.role === "tool_use") {
            const result = msg.toolUseId ? toolResults.get(msg.toolUseId) : undefined;
            return <ToolCard key={i} msg={msg} result={result} />;
          }

          if (msg.role === "assistant") {
            return (
              <div key={i} className="mr-12">
                {msg.thinkingContent && <ThinkingBlock content={msg.thinkingContent} />}
                <div className="bg-gray-800/40 rounded-lg p-3 text-sm">
                  <MarkdownContent text={msg.content} />
                </div>
                {msg.tokensIn != null && (
                  <div className="text-xs text-gray-600 mt-1">
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
