# Gaps & Decisions

Issues found during design review, with resolutions.

---

## Critical: Will Cause Bugs

### 1. Prompt concurrency — reject concurrent queries

A bot can only run one `query()` at a time. If `/prompt` is called while a query is running, return `409 Conflict` with the current task info.

```typescript
let busy = false;
app.post("/prompt", async (c) => {
  if (busy) return c.json({ error: "busy", current_task: ... }, 409);
  busy = true;
  try { /* query() */ } finally { busy = false; }
});
```

Schedule and webhook triggers also check this lock before firing.

### 2. Schedule safety rails

Port from v2. Non-negotiable:

| Guard | Value | Purpose |
|-------|-------|---------|
| Max runs per day | 50 | Prevent runaway cost |
| Run timeout | 10 min | Abort hanging queries |
| Consecutive error auto-pause | 5 | Stop broken schedules |
| Concurrency | 1 at a time | No parallel cron runs |
| Manual trigger | Bypasses budget | For debugging |

### 3. `maxTurns` on `query()`

Set `maxTurns: 25` (same as v2). Without this, a bot can loop infinitely calling tools. Configurable per-bot in config.

### 4. AbortSignal propagation

When a client disconnects during SSE streaming, abort the SDK query:

```typescript
app.post("/prompt", async (c) => {
  const ac = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => ac.abort());
  const conversation = query({ prompt, abortController: ac, options: { ... } });
  // stream...
});
```

Schedule timeout also uses AbortController + `Promise.race`.

### 5. `costs.json` mount — use `--mount` not `-v`

Docker `-v` creates a directory if the file doesn't exist. Use `--mount type=bind` which errors instead. The CLI must pre-create the file before container start:

```typescript
// In spawn logic
if (!existsSync(costsPath)) writeFileSync(costsPath, "{}");
```

### 6. Cron race with prompt

The concurrency lock from #1 covers this. Scheduled prompts check the lock. If busy, the scheduled run is **skipped** (not queued), and logged as `skipped` in run history.

---

## Contradictions: Resolved

### 7. Networking: Tailscale, not Docker DNS

`bot-to-bot.md` was written before the Tailscale decision. **Resolution:**

- `mecha_call` resolves via MagicDNS: `http://mecha-{botname}:3000/prompt`
- `mecha_list` queries Headscale API for nodes tagged `tag:mecha-bot`
- No Docker socket mount needed
- Docker bridge network is still created (for local fallback) but Tailscale is primary

**Action:** Update `bot-to-bot.md`.

### 8. Dashboard: multi-machine is supported

The "v3 is single-machine" note was from early design. **Resolution:** Dashboard supports multi-node. The fleet overview shows all bots across all nodes via Headscale API. No separate "multi-node view" needed — it's the default view.

**Action:** Update `dashboard.md`.

### 9. Container hostname: `mecha-{name}` everywhere

The Tailscale hostname is `mecha-{name}`. The Docker container name is `mecha-{name}`. The `mecha_call` tool prepends `mecha-` automatically:

```
mecha_call("reviewer", "...") → http://mecha-reviewer:3000/prompt
```

The user always refers to the bot as `reviewer`. The `mecha-` prefix is an internal detail.

### 10. Logs: stdout for Docker, structured files for history

**Two log channels, different purposes:**

| Channel | What | Access |
|---------|------|--------|
| stdout/stderr | Real-time operational logs | `docker logs` / `mecha logs` |
| `/state/logs/` | Structured event history (mecha_call graph, schedule runs) | Bot dashboard, network map |

Node.js process logs to stdout (picked up by Docker log driver). Structured events (who called who, schedule outcomes) written to `/state/logs/events.jsonl`.

---

## Gaps: Filled

### 11. Bot path — user-specified, fallback to default

Bots are not always stored at `~/.mecha/bots/<name>/`. The user can specify a path:

```bash
mecha spawn ./bots/reviewer/config.yaml           # bot state lives alongside config
mecha spawn reviewer.yaml --dir ~/my-bots/reviewer # explicit state dir
```

Resolution order:
1. `--dir <path>` flag on `mecha spawn` → use that directory
2. Config file's parent directory (if config is at `./bots/reviewer/config.yaml`, state goes in `./bots/reviewer/`)
3. Fallback: `~/.mecha/bots/<name>/`

The bot's resolved path is stored in a global registry (`~/.mecha/registry.json`):

```json
{
  "reviewer": "/Users/joker/projects/bots/reviewer",
  "researcher": "/home/joker/.mecha/bots/researcher"
}
```

All CLI commands look up the bot path from the registry. This means `mecha chat reviewer` works regardless of where the bot's state lives.

**Action:** Update `cli.md`, `volumes.md`, `bot-config.md`.

### 12. `mecha start` — restart a stopped bot

Add `mecha start <name>` as a command. Reads saved config from the bot's directory, re-spawns the container.

```bash
mecha stop reviewer         # stops container, keeps state
mecha start reviewer        # reads config from registry path, re-spawns
```

Different from `mecha spawn`: `spawn` creates a new bot, `start` restarts an existing one.

**Action:** Update `cli.md`.

### 13. `mecha dashboard` — add as a command

```bash
mecha dashboard             # starts dashboard server, opens browser
mecha dashboard --port 7700 # custom port
```

**Action:** Update `cli.md`.

### 14. Graceful shutdown — s6-overlay

The container runs two long-lived processes: `tailscaled` and `node`. Use **s6-overlay** as the init system:

```
/etc/s6-overlay/s6-rc.d/
├── tailscaled/
│   ├── type        # "longrun"
│   ├── run         # exec tailscaled --state=/state/tailscale/
│   └── finish      # cleanup
├── tailscale-up/
│   ├── type        # "oneshot"
│   ├── up          # tailscale up --auth-key=... --hostname=...
│   └── dependencies.d/
│       └── tailscaled
└── mecha-agent/
    ├── type        # "longrun"
    ├── run         # exec node agent/entry.js
    ├── finish      # flush sessions, close server
    └── dependencies.d/
        └── tailscale-up
```

s6-overlay handles:
- Start ordering (tailscaled → tailscale up → node)
- Signal forwarding (SIGTERM to both processes)
- Container exit when the main service (mecha-agent) dies

The Node.js process handles SIGTERM:

```typescript
process.on("SIGTERM", async () => {
  scheduler.stop();
  await flushSession();
  server.close();
  process.exit(0);
});
```

### 15. Tailscale failure modes

| Failure | Behavior |
|---------|----------|
| Bad auth key at boot | Container exits with error. `mecha ls` shows `error` status. |
| Network down at boot | Retry with backoff (3 attempts, 5s apart). Then start without Tailscale — bot works locally only, `mecha_call` fails. |
| Tailscale disconnects mid-run | Current query completes (uses cached connection). Next `mecha_call` fails with timeout. Bot stays running. |
| Node key expires (180 days) | On next restart, `tailscale up` re-authenticates if using OAuth client secret. If using auth key, container exits with error. |
| MagicDNS resolution fails | `mecha_call` falls back to Tailscale IP from `mecha_list` cache. |

**Recommendation:** Use OAuth client secret instead of auth key. OAuth secrets don't expire. The Tailscale container generates a short-lived auth key from it on each start.

### 16. `mecha_new_session` tool spec

```
Tool: mecha_new_session
Parameters:
  summary: string    # brief description of completed task (optional)
Returns:
  new_task_id: string
  previous_task: { id, summary, status: "completed" }
```

What it does:
1. Marks current task as `completed` in `index.json`
2. Writes `summary` to the completed task's metadata
3. Creates a new task entry with status `active`
4. Returns the new task ID

The next `query()` call starts fresh (no `resume`).

### 17. SSE streaming format

Follow Anthropic's event pattern, simplified for bot responses:

```
event: start
data: {"task_id": "task-abc"}

event: text
data: {"content": "Here's my review"}

event: text
data: {"content": " of the PR..."}

event: tool_use
data: {"tool": "mecha_call", "bot": "researcher", "status": "calling"}

event: tool_result
data: {"tool": "mecha_call", "bot": "researcher", "status": "done"}

event: done
data: {"usage": {"input_tokens": 1200, "output_tokens": 340, "cost_usd": 0.008}}

event: error
data: {"message": "Rate limited", "code": "rate_limit"}
```

Client reads events with `EventSource` or `fetch` + `ReadableStream`.

### 18. `mecha.json` global config schema

```json
{
  "default_model": "sonnet",
  "default_auth": "anthropic-main",
  "headscale": {
    "url": "https://headscale.example.com",
    "api_key": "...",
    "managed": true
  },
  "image": "mecha-agent:latest"
}
```

| Field | Default | Purpose |
|-------|---------|---------|
| `default_model` | `"sonnet"` | Model for bots without explicit config |
| `default_auth` | `null` | Auth profile used when bot doesn't specify |
| `headscale.url` | `null` | Headscale coordination server |
| `headscale.api_key` | `null` | Headscale API key for `mecha_list` |
| `headscale.managed` | `false` | Whether mecha started this Headscale |
| `image` | `"mecha-agent:latest"` | Docker image name |

### 19. Container entrypoint — s6-overlay

See #14 above. s6-overlay is the entrypoint. Dockerfile:

```dockerfile
FROM node:22-alpine

# s6-overlay
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.2.0.2/s6-overlay-noarch.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.2.0.2/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz

# Tailscale + runtime tools (both Node and Python available to bots)
RUN apk add --no-cache tailscale python3 py3-pip git bash curl

# Agent code
COPY agent/ /app/agent/
COPY node_modules/ /app/node_modules/
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
EXPOSE 3000
ENTRYPOINT ["/init"]
```

### 20. Agent SDK `query()` options — full spec

Custom tools (`mecha_call`, `mecha_list`, `mecha_new_session`) are registered via `createSdkMcpServer()` — the SDK's mechanism for adding tools. They are **NOT** passed in `allowedTools` (which is only for filtering existing built-in tools).

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Custom tools as an MCP server (created once, reused across queries)
const mechaToolServer = createSdkMcpServer({
  name: "mecha-tools",
  version: "1.0.0",
  tools: [
    tool("mecha_call", "Call another mecha bot", {
      bot: z.string(), message: z.string(),
    }, async (args) => { /* ... */ }),
    tool("mecha_list", "List available bots", {}, async () => { /* ... */ }),
    tool("mecha_new_session", "Start new task/session", {
      summary: z.string().optional(),
    }, async (args) => { /* ... */ }),
  ]
});

const conversation = query({
  prompt: userPrompt,
  abortController: ac,
  options: {
    model: bot.model,                         // from config
    maxTurns: bot.maxTurns ?? 25,             // safety cap
    systemPrompt: bot.system,                 // from config
    cwd: "/workspace",                        // mounted workspace
    permissionMode: "bypassPermissions",      // autonomous — container is the sandbox
    allowDangerouslySkipPermissions: true,    // required with bypassPermissions
    pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    resume: activeTask?.session_id,           // resume session if exists
    mcpServers: { "mecha-tools": mechaToolServer },  // custom tools
  }
});

for await (const msg of conversation) {
  // msg.type is one of 20+ types; handle the useful ones:
  // "assistant" → msg.message.content (BetaMessage content blocks)
  // "tool_use_summary" → msg.summary
  // "tool_progress" → msg.tool_name, msg.elapsed_time_seconds
  // "result" → msg.total_cost_usd, msg.session_id, msg.duration_ms
}
```

**Important:** `bypassPermissions` is the right default for autonomous bots — there's no human to answer prompts. The container is the sandbox boundary. However, the Claude process must **never run as root** inside the container. The Dockerfile creates a non-root `appuser` (UID 10001) and all volumes are owned by that user. This limits blast radius even with `bypassPermissions`.

**Additional useful options to consider:**
- `maxBudgetUsd` — built-in per-query cost limit (SDK stops if exceeded, returns `error_max_budget_usd`)
- `thinking` / `effort` — control reasoning depth per query
- `disallowedTools` — blocklist specific built-in tools
- `sandbox` — additional tool execution sandboxing

---

## Config Schema: Missing Fields

These need to be added to `bot-config.md`:

```yaml
# New fields
max_turns: 25                           # safety cap for tool-use loops
workspace_writable: false               # mount workspace as rw instead of ro

tailscale:
  auth_key_profile: tailscale-main      # auth profile name
  # OR inline:
  auth_key: tskey-auth-...
  login_server: https://headscale.example.com
  tags: ["tag:mecha-bot"]
```

---

## From v2: Necessary Patterns Not Yet Documented

### 21. Structured logging with redaction

Log to stdout in JSON format. Redact sensitive keys automatically:

```typescript
const REDACT_KEYS = ["token", "authorization", "apikey", "api_key", "secret", "password", "credential", "auth_key"];
```

Configurable via `MECHA_LOG_LEVEL` env var (debug, info, warn, error).

### 22. Health check after spawn

After `docker run`, the CLI must wait for the bot to be healthy before returning:

1. Poll `GET /health` on the container
2. Exponential backoff: 200ms → 400ms → 800ms → 1000ms
3. Timeout after 30s (Tailscale connection can be slow)
4. Report failure with container logs if timeout

### 23. Environment validation on boot

Container entry validates all required env vars with Zod before starting:

```typescript
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  MECHA_BOT_NAME: z.string().min(1),
  MECHA_TS_AUTH_KEY: z.string().optional(),
});
```

Clear error message if validation fails. Container exits with code 1.

### 24. Session resilience

Port from v2:
- Malformed JSONL lines: skip and continue (don't crash)
- Missing `.meta.json`: synthesize from transcript
- Transcript > 100MB: refuse to load, start fresh session
- Corrupt `index.json`: rebuild from filesystem scan

### 25. Stale container cleanup

On `mecha ls` or `mecha spawn`, detect orphaned containers:
- Container exists in Docker but not in registry → warn user
- Registry entry exists but container is gone → mark as `stopped`
- Container in `dead` state → remove and update registry

### 26. Workspace path symlink resolution

Before mounting workspace, resolve symlinks with `realpathSync()`. macOS `/tmp` → `/private/tmp` breaks path matching inside the container without this.

---

## CLI Update Summary

Final command list (11 commands):

```
mecha init [--headscale]
mecha spawn <config.yaml> [--dir <path>] [--expose N]
mecha start <name>                              ← new
mecha stop <name>
mecha rm <name>
mecha ls
mecha chat <name> "prompt"
mecha logs <name> [-f]
mecha auth add <profile> <key>
mecha auth swap <bot> <profile>
mecha dashboard [--port N]                      ← new
```
