import { useState, useRef, useEffect } from "react";
import { botFetch } from "../lib/api";

interface Message {
  role: "user" | "assistant" | "tool" | "error";
  content: string;
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    const prompt = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: prompt }]);
    setBusy(true);

    try {
      const resp = await botFetch("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });

      if (resp.status === 409) {
        setMessages((m) => [...m, { role: "error", content: "Bot is busy" }]);
        setBusy(false);
        return;
      }

      if (!resp.ok) {
        setMessages((m) => [...m, { role: "error", content: `HTTP ${resp.status}` }]);
        setBusy(false);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      let currentText = "";

      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              currentText += data.content;
              setMessages((m) => {
                const updated = [...m];
                updated[updated.length - 1] = { role: "assistant", content: currentText };
                return updated;
              });
            } else if (data.summary) {
              setMessages((m) => [...m, { role: "tool", content: data.summary }]);
            } else if (data.cost_usd !== undefined) {
              setMessages((m) => [
                ...m,
                { role: "tool", content: `Cost: $${data.cost_usd.toFixed(4)} | ${data.duration_ms}ms` },
              ]);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      setMessages((m) => [...m, { role: "error", content: String(err) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${
              msg.role === "user"
                ? "bg-blue-900/40 ml-12"
                : msg.role === "error"
                  ? "bg-red-900/40"
                  : msg.role === "tool"
                    ? "bg-gray-800/60 text-sm text-gray-400"
                    : "bg-gray-800/40 mr-12"
            }`}
          >
            <pre className="whitespace-pre-wrap font-mono text-sm">{msg.content}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={busy ? "Processing..." : "Type a message..."}
          disabled={busy}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-6 py-2 rounded-lg font-medium"
        >
          Send
        </button>
      </div>
    </div>
  );
}
