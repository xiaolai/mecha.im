---
name: tool-ui
description: Add beautiful UI components for AI tool calls using @assistant-ui/tool-ui registry.
---

# tool-ui Skill

Use this skill when adding or customizing UI components that render AI tool call arguments and results. Tool UI provides pre-built, accessible, typed components distributed via the shadcn registry.

## Context7 Lookup

Always fetch the latest docs before generating code:

```
resolve-library-id: "tool-ui"
query-docs: libraryId="/assistant-ui/tool-ui"
```

## Setup

### 1. Configure shadcn Registry

Add the `@tool-ui` registry to your `components.json`:

```json
{
  "registries": {
    "@assistant-ui": "https://r.assistant-ui.com/{name}.json",
    "@tool-ui": "https://tool-ui.com/r/{name}.json"
  }
}
```

### 2. Install Components

```bash
# Install individual components
npx shadcn@latest add https://tool-ui.com/r/link-preview.json
npx shadcn@latest add https://tool-ui.com/r/data-table.json
npx shadcn@latest add https://tool-ui.com/r/chart.json
npx shadcn@latest add https://tool-ui.com/r/code-block.json
npx shadcn@latest add https://tool-ui.com/r/plan.json
npx shadcn@latest add https://tool-ui.com/r/option-list.json
npx shadcn@latest add https://tool-ui.com/r/approval-card.json

# List all available components
curl https://tool-ui.com/r/registry.json | jq '.items[].name'
```

## Integration Patterns

### Pattern 1: makeAssistantToolUI (Simple)

Register a tool-ui component with `makeAssistantToolUI` from `@assistant-ui/react`:

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";
import { LinkPreview, safeParseSerializableLinkPreview } from "@/components/tool-ui/link-preview";

const LinkPreviewToolUI = makeAssistantToolUI<
  { url: string },
  { href: string; title: string; image?: string; domain: string }
>({
  toolName: "previewLink",
  render: ({ args, status, result }) => {
    if (status.type === "running") return <p>Loading preview for {args.url}...</p>;
    if (status.type === "incomplete") return <p>Failed to load preview.</p>;

    const parsed = safeParseSerializableLinkPreview(result);
    if (!parsed) return null;
    return <LinkPreview {...parsed} maxWidth="420px" />;
  },
});

// Mount <LinkPreviewToolUI /> inside AssistantRuntimeProvider
```

### Pattern 2: Toolkit Registration (Recommended)

Use the `Tools` + `useAui` pattern for cleaner multi-tool registration:

```tsx
import { AssistantRuntimeProvider, Tools, useAui, type Toolkit } from "@assistant-ui/react";
import { LinkPreview, safeParseSerializableLinkPreview } from "@/components/tool-ui/link-preview";
import { DataTable, safeParseSerializableDataTable } from "@/components/tool-ui/data-table";
import { createResultToolRenderer } from "@/components/tool-ui/shared";

const toolkit: Toolkit = {
  previewLink: {
    type: "backend",
    render: createResultToolRenderer({
      safeParse: safeParseSerializableLinkPreview,
      render: (parsed) => <LinkPreview {...parsed} maxWidth="420px" />,
    }),
  },
  showData: {
    type: "backend",
    render: createResultToolRenderer({
      safeParse: safeParseSerializableDataTable,
      render: (parsed) => <DataTable {...parsed} />,
    }),
  },
};

function App() {
  const runtime = useLocalRuntime(myAdapter);
  const aui = useAui({ tools: Tools({ toolkit }) });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

### Pattern 3: Backend Tool Definition (AI SDK)

Define tools server-side with output schemas matching component expectations:

```ts
import { tool } from "ai";
import { z } from "zod";
import { SerializableLinkPreviewSchema } from "@/components/tool-ui/link-preview/schema";

export const tools = {
  previewLink: tool({
    description: "Show a preview card for a URL",
    inputSchema: z.object({ url: z.string().url() }),
    outputSchema: SerializableLinkPreviewSchema,
    async execute({ url }) {
      return {
        id: "link-1",
        href: url,
        title: "Page Title",
        domain: new URL(url).hostname,
      };
    },
  }),
};
```

## Available Components

| Component | Install | Use Case |
|-----------|---------|----------|
| `link-preview` | `tool-ui.com/r/link-preview.json` | URL preview cards |
| `data-table` | `tool-ui.com/r/data-table.json` | Tabular data display |
| `chart` | `tool-ui.com/r/chart.json` | Data visualization |
| `code-block` | `tool-ui.com/r/code-block.json` | Syntax-highlighted code |
| `plan` | `tool-ui.com/r/plan.json` | Step-by-step plans |
| `option-list` | `tool-ui.com/r/option-list.json` | Choice/selection lists |
| `approval-card` | `tool-ui.com/r/approval-card.json` | Human-in-the-loop approval |

Each component exports:
- The component itself (e.g., `LinkPreview`)
- A Zod schema (e.g., `SerializableLinkPreviewSchema`)
- A safe parser (e.g., `safeParseSerializableLinkPreview`)
- A `createResultToolRenderer` helper from `@/components/tool-ui/shared`

## Component Anatomy

Each installed tool-ui component follows this structure:

```
components/tool-ui/<name>/
  index.tsx          # Main component
  schema.ts          # Zod schema for serializable props
  <name>.stories.tsx # Optional storybook
```

## Key Rules

1. Always install via shadcn registry (`npx shadcn@latest add <url>`) — components are copy-pasted into your project, not imported from node_modules
2. Use `safeParseSerializable*` helpers to validate tool results before rendering
3. Each tool-ui component is self-contained with its own schema — import the schema for backend tool definitions
4. Use `createResultToolRenderer` for the cleanest toolkit registration pattern
5. Tool names in `makeAssistantToolUI({ toolName })` must match backend tool names exactly
