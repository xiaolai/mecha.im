# Bot-to-Bot Communication

## Mechanism

Bots communicate via the `mecha_call` tool registered as an MCP server via `createSdkMcpServer()` and passed to `query()` via the `mcpServers` option. Under the hood, it's an HTTP POST to the target bot's `/prompt` endpoint over the Tailscale mesh.

## Tools

### `mecha_call`

Call another bot by name and get a response.

```
Tool: mecha_call
Parameters:
  bot: string       # target bot name (e.g. "reviewer")
  message: string   # prompt to send
Returns:
  response: string  # bot's response
```

Internal resolution: `bot` → `http://mecha-{bot}:3000/prompt`

MagicDNS handles name resolution. The `mecha-` prefix is added automatically — the user and the calling bot always use the short name.

If the target bot is busy (already processing a query), `mecha_call` returns an error: `"reviewer is busy processing another request"`.

### `mecha_list`

Discover available bots on the network.

```
Tool: mecha_list
Parameters: none
Returns:
  bots: [{ name, node, status, model, system_summary, ip }]
```

Queries Headscale API for nodes tagged `tag:mecha-bot`. Discovers bots across all machines on the tailnet.

### `mecha_new_session`

Start a fresh conversation task.

```
Tool: mecha_new_session
Parameters:
  summary: string   # brief description of completed task (optional)
Returns:
  new_task_id: string
  previous_task: { id, summary, status: "completed" }
```

Marks current task as completed, creates a new one. The next query starts fresh.

## Example Flow

```
User: "Coordinate a code review"
  → coordinator bot
    → mecha_list → ["reviewer", "researcher"]
    → mecha_call(bot="researcher", message="find similar bugs in the codebase")
    ← researcher response
    → mecha_call(bot="reviewer", message="review PR #42, considering: {researcher_findings}")
    ← reviewer response
  ← coordinator synthesizes and responds
```

## Network

All bots join the Tailscale mesh on boot. MagicDNS hostname: `mecha-{name}`.

No port exposure needed for inter-bot traffic — Tailscale handles routing and encryption (WireGuard). External webhook access requires explicit `expose` in bot config.

## Auth Between Bots

No auth for inter-bot calls — the Tailscale network is the trust boundary. Only nodes on the tailnet can reach each other. ACLs can further restrict which bots can talk to which.
