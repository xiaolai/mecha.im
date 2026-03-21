---
name: assistant-ui
description: Build AI chat interfaces using @assistant-ui/react primitives and styled components.
---

# assistant-ui Skill

Use this skill when building or modifying AI chat interfaces in this project. The project uses `@assistant-ui/react` for chat UI primitives and `@assistant-ui/react-ui` for pre-styled shadcn components.

## Context7 Lookup

Always fetch the latest docs before generating code:

```
resolve-library-id: "assistant-ui"
query-docs: libraryId="/websites/assistant-ui"
```

## Package Architecture

| Package | Purpose |
|---------|---------|
| `@assistant-ui/react` | Low-level Radix UI primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`) |
| `@assistant-ui/react-ui` | Pre-styled shadcn/ui components (`Thread`, `ThreadList`, `AssistantModal`, etc.) |
| `@assistant-ui/react-ai-sdk` | Vercel AI SDK integration (`useChatRuntime`, `AssistantChatTransport`) |

## Core Patterns

### LocalRuntime with Custom API (current project pattern)

The dashboard uses `useLocalRuntime` with a custom `ChatModelAdapter` to proxy chat through the mecha runtime API:

```tsx
"use client";

import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";

const myAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.map(m => ({
        role: m.role,
        content: m.content.filter(c => c.type === "text").map(c => c.text).join(""),
      })) }),
      signal: abortSignal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Parse SSE data frames
      const chunk = decoder.decode(value, { stream: true });
      // ... extract text from SSE events
      fullText += extractedText;
      yield { content: [{ type: "text", text: fullText }] };
    }
  },
};

function ChatProvider({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(myAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
```

### Thread Component (Primitives)

Build custom thread UIs using primitives:

```tsx
"use client";

import { ThreadPrimitive, MessagePrimitive, ComposerPrimitive, ActionBarPrimitive } from "@assistant-ui/react";

export const Thread = () => (
  <ThreadPrimitive.Root>
    <ThreadPrimitive.Viewport>
      <ThreadPrimitive.Empty>
        <p>Send a message to start.</p>
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages
        components={{ UserMessage, AssistantMessage }}
      />
    </ThreadPrimitive.Viewport>
    <Composer />
  </ThreadPrimitive.Root>
);

const UserMessage = () => (
  <MessagePrimitive.Root>
    <MessagePrimitive.Content />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root>
    <MessagePrimitive.Content />
    <ActionBarPrimitive.Root>
      <ActionBarPrimitive.Copy />
      <ActionBarPrimitive.Reload />
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const Composer = () => (
  <ComposerPrimitive.Root>
    <ComposerPrimitive.Input placeholder="Type a message..." />
    <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
  </ComposerPrimitive.Root>
);
```

### Installing Pre-styled Components (shadcn)

```bash
# Thread component (styled)
npx assistant-ui@latest add thread

# Thread list (for multi-conversation)
npx shadcn@latest add https://r.assistant-ui.com/thread-list.json

# Markdown rendering
npx shadcn@latest add https://r.assistant-ui.com/markdown.json
```

### Tool Call Rendering with makeAssistantToolUI

Register custom UI for tool calls (see also: tool-ui skill):

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";

const WeatherToolUI = makeAssistantToolUI<
  { location: string },
  { temperature: number; description: string }
>({
  toolName: "getWeather",
  render: ({ args, status, result }) => {
    if (status.type === "running") return <p>Loading weather for {args.location}...</p>;
    if (status.type === "incomplete" && status.reason === "error") return <p>Error</p>;
    return <p>{result.temperature} - {result.description}</p>;
  },
});

// Mount inside AssistantRuntimeProvider:
// <WeatherToolUI />
```

### ToolFallback for Unregistered Tools

```tsx
<Thread
  components={{
    ToolFallback: ({ toolName, args, result }) => (
      <div>
        <code>{toolName}({JSON.stringify(args)})</code>
        {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </div>
    ),
  }}
/>
```

## Project-Specific Notes

- Dashboard chat: `packages/dashboard/src/components/MechaChat.tsx` — uses `useLocalRuntime` with SSE streaming adapter
- Thread primitives: `packages/dashboard/src/components/assistant-ui/thread.tsx`
- Chat API proxy: `packages/dashboard/src/app/api/mechas/[id]/chat/route.ts` — forwards to mecha runtime
- UI chat panel: `packages/ui/src/components/ChatPanel.tsx`

## Key Rules

1. Always use `"use client"` for components using hooks or primitives
2. Wrap chat trees in `<AssistantRuntimeProvider runtime={runtime}>`
3. For SSE streaming, use `async *run()` generator pattern in adapters
4. Place `<ToolUI />` components inside the provider tree to register them
5. Use primitives (`@assistant-ui/react`) for custom styling; use styled components (`@assistant-ui/react-ui`) for quick scaffolding
