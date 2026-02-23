"use client";

import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLocalRuntime, type ChatModelAdapter, type ChatModelRunUpdate } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { fetchSessionHistory, type InitialMessage } from "@/lib/session-history";

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
type AssistantContentPart = ChatModelRunUpdate["content"][number];

function createMechaAdapter(mechaId: string, sessionId: string, node?: string, onStreamComplete?: () => void): ChatModelAdapter {
  const nodeParam = node && node !== "local"
    ? `?node=${encodeURIComponent(node)}`
    : "";
  return {
    async *run({ messages, abortSignal }) {
      try {
        const lastUserMsg = messages.filter((m) => m.role === "user").pop();
        const message = lastUserMsg?.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("") ?? "";

        const url = `/api/mechas/${mechaId}/sessions/${sessionId}/message${nodeParam}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
          signal: abortSignal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        yield* readSSEStream(reader);
      } finally {
        onStreamComplete?.();
      }
    },
  };
}

async function* readSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<{ content: AssistantContentPart[] }> {
  const decoder = new TextDecoder();
  let buffer = "";
  let latestParts: AssistantContentPart[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      latestParts = processLine(line, latestParts);
    }
    if (latestParts.length > 0) yield { content: latestParts };
  }

  // Flush trailing multibyte characters from the decoder
  buffer += decoder.decode();

  // Flush residual buffer at EOF
  if (buffer.trim()) {
    latestParts = processLine(buffer, latestParts);
    if (latestParts.length > 0) yield { content: latestParts };
  }
}

function processLine(line: string, current: AssistantContentPart[]): AssistantContentPart[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") return current;
  if (!trimmed.startsWith("data: ")) return current;

  try {
    const event = JSON.parse(trimmed.slice(6));
    const result = extractContentParts(event);
    if (result) return applyResult(current, result);
  } catch {
    // skip malformed
  }
  return current;
}

function applyResult(current: AssistantContentPart[], result: NonNullable<ExtractResult>): AssistantContentPart[] {
  if (result.mode === "full") return result.parts;
  // Delta mode always produces a single text part
  const deltaPart = result.parts[0];
  if (!deltaPart || deltaPart.type !== "text") return current;
  const lastPart = current[current.length - 1];
  if (lastPart && lastPart.type === "text") {
    return [
      ...current.slice(0, -1),
      { type: "text" as const, text: lastPart.text + deltaPart.text },
    ];
  }
  return [...current, deltaPart];
}

type ExtractResult = { mode: "full" | "delta"; parts: AssistantContentPart[] } | null;

function extractContentParts(event: Record<string, unknown>): ExtractResult {
  // Claude Code SSE: {"type":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"...","input":{...}}]}}
  // This sends the full accumulated content each time, so use "full" mode to replace
  if (event.type === "assistant") {
    const msg = event.message as Record<string, unknown> | undefined;
    if (msg && Array.isArray(msg.content)) {
      const parts: AssistantContentPart[] = [];
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push({ type: "text" as const, text: block.text });
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          const input = (block.input ?? {}) as Record<string, JSONValue>;
          parts.push({
            type: "tool-call" as const,
            toolCallId: (block.id as string) ?? crypto.randomUUID(),
            toolName: block.name,
            args: input,
            argsText: JSON.stringify(input, null, 2),
          });
        }
      }
      if (parts.length > 0) return { mode: "full", parts };
    }
  }
  // Anthropic streaming: content_block_delta (incremental, text only)
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return { mode: "delta", parts: [{ type: "text", text: delta.text }] };
    }
  }
  if (event.type === "text" && typeof event.text === "string") {
    return { mode: "delta", parts: [{ type: "text", text: event.text }] };
  }
  // OpenAI-style (incremental, text only)
  if (Array.isArray(event.choices)) {
    const choice = (event.choices as Array<Record<string, unknown>>)[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string") {
      return { mode: "delta", parts: [{ type: "text", text: delta.content }] };
    }
  }
  return null;
}

interface MechaChatProps {
  mechaId: string;
  sessionId: string;
  node?: string;
  onStreamComplete?: () => void;
}

export function MechaChat({ mechaId, sessionId, node, onStreamComplete }: MechaChatProps) {
  const [history, setHistory] = useState<InitialMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSessionHistory(mechaId, sessionId, node)
      .then((messages) => { if (!cancelled) setHistory(messages); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [mechaId, sessionId, node]);

  if (history === null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  return (
    <MechaChatInner
      mechaId={mechaId}
      sessionId={sessionId}
      node={node}
      initialMessages={history}
      onStreamComplete={onStreamComplete}
    />
  );
}

function MechaChatInner({
  mechaId,
  sessionId,
  node,
  initialMessages,
  onStreamComplete,
}: MechaChatProps & { initialMessages: InitialMessage[] }) {
  const adapter = useMemo(() => createMechaAdapter(mechaId, sessionId, node, onStreamComplete), [mechaId, sessionId, node, onStreamComplete]);
  const runtime = useLocalRuntime(adapter, {
    initialMessages: initialMessages.length > 0 ? initialMessages : undefined,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full overflow-hidden">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
