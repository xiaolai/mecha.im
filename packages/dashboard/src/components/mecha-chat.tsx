"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeftIcon, SendIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface MechaChatProps {
  name: string;
}

export function MechaChat({ name }: MechaChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch(`/api/casas/${encodeURIComponent(name)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.error}` }]);
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setSending(false);
        return;
      }

      const decoder = new TextDecoder();
      let assistantContent = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "error" && event.content) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: `Error: ${event.content}` };
                return updated;
              });
            } else if (event.type === "text" && event.content) {
              assistantContent += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            } else if (event.type === "done" && event.sessionId) {
              setSessionId(event.sessionId);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: Connection failed" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Link href={`/casa/${encodeURIComponent(name)}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold text-foreground">Chat with {name}</h1>
        {sessionId && (
          <span className="text-xs font-mono text-muted-foreground">{sessionId}</span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Send a message to start chatting.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {msg.content || (sending && i === messages.length - 1 && (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border pt-3">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={sending}
            className="h-11 sm:h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={sending || !input.trim()}>
            <SendIcon className="size-4" />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
