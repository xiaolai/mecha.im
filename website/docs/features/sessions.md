# Sessions & Chat

Every conversation with a Mecha agent is a **session** — a persistent thread of messages stored as files on disk.

## Chatting

```bash
# Send a message and stream the response
mecha chat researcher "Summarize the latest papers in my workspace"
```

The response streams to your terminal via Server-Sent Events (SSE). You'll see the agent's thinking process and final response in real time.

## Session Management

```bash
# List all sessions for an agent
mecha sessions list researcher

# Show a specific session transcript
mecha sessions show researcher <session-id>
```

## Session Storage

Sessions are stored as plain files — no database:

```
~/.mecha/researcher/home/.claude/projects/-Users-you-papers/
├── abc123.meta.json     ← metadata
└── abc123.jsonl         ← transcript
```

### Metadata (`*.meta.json`)

```json
{
  "title": "Paper summarization",
  "starred": false,
  "createdAt": "2026-02-26T10:00:00Z",
  "updatedAt": "2026-02-26T10:05:00Z"
}
```

### Transcript (`*.jsonl`)

Each line is a JSON event — matching the Claude Agent SDK's native format:

```jsonl
{"type":"user","message":"Summarize the latest papers"}
{"type":"assistant","message":"I found 3 papers in your workspace..."}
{"type":"tool_use","name":"mecha_workspace_list","input":{}}
{"type":"tool_result","content":[{"type":"text","text":"paper1.pdf\npaper2.pdf"}]}
```

## MCP Tools

Each CASA exposes workspace tools via the MCP (Model Context Protocol):

| Tool | Description |
|------|-------------|
| `mecha_workspace_list` | List files in the workspace |
| `mecha_workspace_read` | Read a file from the workspace |
| `mesh_query` | Query another CASA through the mesh |
| `mesh_discover` | Discover available CASAs by tag/capability |

These tools are available to the Claude agent during conversations, enabling file access and inter-agent communication.
