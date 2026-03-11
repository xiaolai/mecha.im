# Implementation Plan (Revised)

Ordered phases. Each phase produces a working increment you can test. Revised after Codex review to fix sequencing, session model, networking, and bootstrap issues.

---

## Phase 0: Shared foundations

**Goal:** Core utilities that every later phase depends on. Build once, use everywhere.

```
shared/
├── errors.ts                 # MechaError base class with code, statusCode, exitCode
├── safe-read.ts              # safeReadJson() — discriminated union, no exceptions
├── atomic-write.ts           # write to temp file + rename
├── validation.ts             # name, tag, port validation helpers
└── mutex.ts                  # per-resource async mutex
```

**Tasks:**
- [ ] `npm init`, install shared deps (zod, typescript, yaml)
- [ ] Create tsconfig base + two project references (cli, agent)
- [ ] Add build scripts: `build:agent`, `build:cli`, `build`
- [ ] Port from v1: `safeReadJson()` (discriminated union result type)
- [ ] Port from v1: `MechaError` base class + `defError()` factory
- [ ] Port from v1: validation helpers (bot name regex, port parsing)
- [ ] Implement: atomic file write (temp + rename)
- [ ] Implement: async mutex (per-resource lock, used for Docker ops and query concurrency)

**Milestone:** Foundation modules importable by both CLI and agent. ✓

---

## Phase 1: Container that accepts prompts

**Goal:** A minimal Docker image that runs Claude Agent SDK, accepts a prompt via HTTP, streams a response. **No Tailscale, no s6-overlay.** Single-process container.

### 1.1 Agent HTTP server

```
agent/
├── entry.ts                  # main: validate env, load config, start server, handle SIGTERM
└── server.ts                 # Hono: /health, /prompt
```

**Tasks:**
- [ ] Install agent deps: hono, @hono/node-server, @anthropic-ai/claude-agent-sdk, zod, @anthropic-ai/sdk (for BetaMessage types)
- [ ] `entry.ts`:
  - Validate env vars with Zod (`ANTHROPIC_API_KEY`, `MECHA_BOT_NAME`)
  - Read `/config/bot.yaml` via `safeReadJson()` (YAML parse + Zod validate)
  - Start Hono server on :3000
  - SIGTERM handler: stop accepting requests, flush state, exit
- [ ] `server.ts`: Hono app
  - `GET /health` → `{ status: "ok", name, model, uptime }`
  - `POST /prompt` → accepts `{ message }`, runs `query()`, streams SSE
- [ ] Concurrency lock (mutex): reject with `409 Conflict` if already processing a query
- [ ] AbortSignal: wire `req.signal` abort → `abortController` on `query()`
- [ ] `query()` call — SDK spawns `claude` CLI as child process:
  ```typescript
  const conversation = query({
    prompt: message,
    abortController: ac,
    options: {
      model: config.model,
      maxTurns: config.max_turns ?? 25,
      systemPrompt: config.system,
      cwd: "/workspace",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,  // required with bypassPermissions
      maxBudgetUsd: config.max_budget_usd,    // optional per-query cost limit
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    }
  });
  ```
- [ ] Stream SDK messages → SSE events. SDK yields 20+ message types; map the useful ones:
  ```typescript
  for await (const msg of conversation) {
    switch (msg.type) {
      case "assistant":
        // msg.message is a BetaMessage — extract text from content blocks
        for (const block of msg.message.content) {
          if (block.type === "text") emit SSE "text" { content: block.text }
          if (block.type === "tool_use") emit SSE "tool_use" { tool: block.name, input: block.input }
        }
        break;
      case "tool_use_summary":
        // msg.summary — human-readable summary of tool execution
        emit SSE "tool_summary" { summary: msg.summary }
        break;
      case "tool_progress":
        // msg.tool_name, msg.elapsed_time_seconds — long-running tool feedback
        emit SSE "tool_progress" { tool: msg.tool_name, elapsed: msg.elapsed_time_seconds }
        break;
      case "result":
        // msg.total_cost_usd, msg.session_id, msg.duration_ms, msg.subtype
        emit SSE "done" { cost_usd, session_id, duration_ms, success: msg.subtype === "success" }
        break;
    }
    // Ignore: system, user, stream_event, auth_status, compact_boundary, etc.
  }
  ```
- [ ] SSE event format:
  ```
  event: start          data: {"task_id": "..."}
  event: text           data: {"content": "..."}
  event: tool_use       data: {"tool": "...", "input": {...}}
  event: tool_summary   data: {"summary": "Read 3 files..."}
  event: tool_progress  data: {"tool": "Bash", "elapsed": 5.2}
  event: done           data: {"cost_usd": 0.05, "session_id": "uuid", "duration_ms": 3200, "success": true}
  event: error          data: {"message": "...", "code": "..."}
  ```

### 1.2 Dockerfile (minimal)

```dockerfile
# Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY shared/ shared/
COPY agent/ agent/
RUN npx tsc -p tsconfig.agent.json

# Runtime
FROM node:22-alpine
RUN adduser -D -u 10001 appuser
# Both runtimes available — bots use Bash freely with bypassPermissions
RUN apk add --no-cache python3 py3-pip git bash curl
# Claude Code CLI — Agent SDK spawns this as child process
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
# Agent SDK + other deps come from build stage's node_modules
COPY --from=build /app/dist/agent ./agent
COPY --from=build /app/dist/shared ./shared
COPY --from=build /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
CMD ["node", "agent/entry.js"]
```

**No s6-overlay, no Tailscale.** Single process, tini not needed with Node as PID 1 (handles signals).

### 1.3 Smoke test

```bash
docker build -t mecha-agent .
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e MECHA_BOT_NAME=test \
  mecha-agent

curl -N -X POST http://localhost:3000/prompt \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello, who are you?"}'
```

**Milestone:** Container starts, accepts a prompt, streams SSE response. ✓

---

## Phase 2: CLI — spawn, chat, ls, stop + auth bootstrap

**Goal:** Core lifecycle commands. Auth via env var or profiles.

### 2.1 Auth (early bootstrap)

```
src/
└── auth.ts                   # auth profile CRUD
```

**Tasks:**
- [ ] `mecha auth add <profile> <key>` — detect type from prefix (`sk-ant-` → api_key, `tskey-` → tailscale), write to `~/.mecha/auth/<profile>.json`
- [ ] `resolveAuth(config)`:
  1. Explicit `auth` profile in config → look up from `~/.mecha/auth/`
  2. `default_auth` in `mecha.json` → look up
  3. `ANTHROPIC_API_KEY` env var → use directly (no profile needed)
  4. Nothing → error with clear message
- [ ] Auth profiles are optional — env var works from day one

### 2.2 Store & registry

```
src/
├── store.ts                  # ~/.mecha/ dir management, registry.json CRUD
└── config.ts                 # load + validate bot YAML (zod schema)
```

**Tasks:**
- [ ] `store.ts`:
  - `ensureMechaDir()` → create `~/.mecha/`, `~/.mecha/auth/`
  - Registry CRUD: `getBot(name) → path`, `setBot(name, path)`, `removeBot(name)`, `listBots()`
  - `mecha.json` read with defaults (atomic write)
  - All file ops use `safeReadJson()` and atomic writes
- [ ] `config.ts`:
  - Zod schema for bot config (all fields from bot-config.md)
  - Cross-field validation
  - Load from YAML file or construct from inline flags

### 2.3 Docker operations

```
src/
└── docker.ts                 # dockerode: spawn, stop, ls, inspect, logs
```

**Tasks:**
- [ ] Per-bot mutex: serialize Docker operations on same bot name
- [ ] `spawn(config, botPath, opts)`:
  - Resolve bot path (--dir > config parent > `~/.mecha/bots/<name>/`)
  - Create subdirs: sessions/, data/, logs/, claude/
  - Pre-create `costs.json` if missing (`echo '{}'`)
  - Resolve workspace path with `realpathSync()` (macOS symlink fix)
  - Resolve auth → env var via `resolveAuth()`
  - Build docker args: `--mount type=bind` (not `-v`), env vars, `--name mecha-{name}`, labels
  - Start container via dockerode
  - Health check: poll `GET /health`, exponential backoff (200ms → 1s), 30s timeout
  - On timeout: show container logs, error with hint
  - Register in `registry.json`
- [ ] `stop(name)` → docker stop, keep state
- [ ] `remove(name)` → docker stop + rm, deregister
- [ ] `list()` → local `docker ps --filter label=mecha.bot`, enrich from registry.json (model, schedule count from saved config)
- [ ] `logs(name, follow)` → docker logs stream
- [ ] Stale detection: warn on orphaned containers, clean stale registry entries

### 2.4 CLI entry point

```
src/
└── cli.ts                    # commander program
```

**Tasks:**
- [ ] Hashbang entry: `#!/usr/bin/env node`
- [ ] `mecha init` → create `~/.mecha/` structure, build Docker image
- [ ] `mecha spawn <config> [--dir] [--expose]` → validate, spawn
- [ ] `mecha spawn --name X --system "..." [--model M]` → inline spawn
- [ ] `mecha start <name>` → look up in registry, read saved config, re-spawn
- [ ] `mecha stop <name>` → docker stop
- [ ] `mecha rm <name>` → confirm if sessions exist, remove
- [ ] `mecha ls` → local table: NAME, STATUS, MODEL, SCHEDULE (local only, no network columns yet)
- [ ] `mecha chat <name> "prompt"` → resolve bot container IP via docker inspect, POST `/prompt`, stream SSE to stdout. If 409 → "Bot is busy" + show current task
- [ ] `mecha logs <name> [-f]` → docker logs
- [ ] `mecha auth add <profile> <key>` → store profile
- [ ] Error handling: `MechaError` classes, exit codes
- [ ] `bin` field in package.json → `mecha`

### 2.5 End-to-end test

```bash
# With env var (no profile needed)
export ANTHROPIC_API_KEY=sk-ant-...
mecha init
mecha spawn --name greeter --system "You greet people warmly."
mecha ls
mecha chat greeter "Hi there!"
mecha stop greeter
mecha start greeter
mecha chat greeter "Remember me?"
mecha rm greeter

# With profile
mecha auth add anthropic-main sk-ant-...
mecha spawn reviewer.yaml   # config references auth: anthropic-main
```

**Milestone:** Full lifecycle via CLI. Auth works via env var or profiles. ✓

---

## Phase 3: Sessions & persistence

**Goal:** Per-task session management. Bots remember conversations. Cost tracking.

### Session model (resolved)

**One source of truth: Agent SDK session via `.claude/` mount.**

The Agent SDK manages its own session state in `/home/appuser/.claude/` (mounted from host). Our `index.json` is a lightweight metadata layer on top:

```
/state/sessions/index.json     # task registry: active task, summaries, timestamps
/home/appuser/.claude/         # SDK session state (the actual conversation memory)
```

**How it works:**
- Each "task" has an ID and maps to an SDK session
- `index.json` tracks: which task is active, task summaries, creation time, status
- The SDK handles conversation replay/resume natively — we don't re-implement it
- `mecha_new_session` clears the SDK session and starts a new task entry
- On restart: SDK resumes from `.claude/` state, we read `index.json` for metadata

### 3.1 Session manager (container)

```
agent/
└── session.ts                # task metadata CRUD, SDK session coordination
```

**Tasks:**
- [ ] Read `index.json` on boot via `safeReadJson()` (handle missing → create default)
- [ ] On prompt: if no active task, create one (generate ID, write to index.json)
- [ ] Track active task metadata: id, created, status, summary, session_id, cost_usd
- [ ] Capture `session_id` from SDK `result` message and store in task entry
- [ ] Pass `resume: activeTask?.session_id` to `query()` options for session continuity
- [ ] Pass `pathToClaudeCodeExecutable: "/usr/local/bin/claude"` in `query()` options
- [ ] Atomic writes for index.json
- [ ] Resilience: corrupt index.json → rebuild from SDK state, log warning

### 3.2 MCP tool server (container)

All custom tools (`mecha_new_session`, `mecha_call`, `mecha_list`) are registered via `createSdkMcpServer()` — the SDK's mechanism for custom tools. They are NOT added via `allowedTools`.

```
agent/tools/
├── mecha-server.ts            # createSdkMcpServer() with all mecha tools
└── mecha-new-session.ts       # tool handler for mecha_new_session
```

**Tasks:**
- [ ] Create MCP server using `createSdkMcpServer()` + `tool()` helper from SDK:
  ```typescript
  import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
  import { z } from "zod";

  export const mechaToolServer = createSdkMcpServer({
    name: "mecha-tools",
    version: "1.0.0",
    tools: [
      tool("mecha_new_session", "Start a new task/session", {
        summary: z.string().optional().describe("Summary of completed task"),
      }, async (args) => {
        // mark current task completed, create new task entry
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }),
      // mecha_call and mecha_list added in Phase 4
    ]
  });
  ```
- [ ] Wire into `query()` via `mcpServers` option (NOT `allowedTools`):
  ```typescript
  options: {
    mcpServers: { "mecha-tools": mechaToolServer },
    // SDK auto-discovers tools from MCP servers
  }
  ```
- [ ] `mecha_new_session` handler:
  - Parameters: `{ summary?: string }`
  - Returns: `{ new_task_id, previous_task: { id, summary, status: "completed" } }`
  - Action: mark current task as completed, clear SDK session state, create new task entry

### 3.3 Cost tracking (container)

```
agent/
└── costs.ts                  # token accumulation + persistence
```

**Tasks:**
- [ ] Capture `total_cost_usd` from SDK `result` message (no manual token counting or pricing table needed)
- [ ] Three buckets: task (resets on new_session), today (midnight UTC), lifetime
- [ ] Accumulate: `task.cost_usd += result.total_cost_usd` per query
- [ ] Write to `/state/costs.json` after each query (atomic write)
- [ ] Prune daily entries > 90 days on boot
- [ ] `GET /api/costs` route

### 3.4 Restart test

```bash
mecha spawn --name reviewer --system "You are a code reviewer."
mecha chat reviewer "Review this function: function add(a,b) { return a + b }"
mecha stop reviewer
mecha start reviewer
mecha chat reviewer "What did we discuss earlier?"
# Bot should remember the previous conversation
```

**Milestone:** Sessions persist across restarts via SDK. Cost tracking works. ✓

---

## Phase 4: Tailscale & bot-to-bot communication

**Goal:** Bots get Tailscale IPs and talk to each other. Host joins tailnet too.

### 4.1 Dockerfile v2: multi-process with s6-overlay

Upgrade the Dockerfile to support two processes:

```dockerfile
# Runtime stage additions:
# - Install s6-overlay
# - Install tailscale (apk add tailscale)
# - s6 service: tailscaled (longrun)
# - s6 service: tailscale-up (oneshot, depends on tailscaled)
# - s6 service: mecha-agent (longrun, depends on tailscale-up)
# - ENTRYPOINT ["/init"]
```

**Tasks:**
- [ ] Add s6-overlay to Dockerfile
- [ ] Service: `tailscaled` — starts daemon with `--state=/state/tailscale/`
- [ ] Service: `tailscale-up` — runs `tailscale up --auth-key=$MECHA_TS_AUTH_KEY --hostname=mecha-$MECHA_BOT_NAME`
- [ ] Service: `mecha-agent` — starts Node process, depends on tailscale-up
- [ ] Graceful shutdown: s6 finish scripts flush sessions, stop scheduler
- [ ] Handle Tailscale failure: retry 3x5s, then start without Tailscale (local-only mode, log warning)
- [ ] Persist state in `/state/tailscale/` (survives restart without new auth key)
- [ ] Add `tailscale/` subdir to bot path creation in CLI spawn

### 4.2 Host joins tailnet

The host CLI must also be on the tailnet to:
- `mecha chat` bots on remote machines
- Dashboard proxy to bot UIs
- `mecha ls` across nodes

**Tasks:**
- [ ] `mecha init --headscale` starts a Headscale container, stores URL + API key in `mecha.json`
- [ ] Document: user must have Tailscale installed on host (or join a Headscale)
- [ ] `mecha ls` enhanced: merge local `docker ps` with Headscale API for remote bots
- [ ] `mecha chat` resolves bot address: local docker inspect first, then MagicDNS/Tailscale IP
- [ ] Add NODE and IP columns to `mecha ls` output

### 4.3 `mecha_call` tool (container)

Add to the existing `mechaToolServer` (created in Phase 3 via `createSdkMcpServer()`):

```
agent/tools/
└── mecha-call.ts              # tool handler, added to mecha-server.ts
```

**Tasks:**
- [ ] Add `mecha_call` tool to `mechaToolServer.tools[]`:
  ```typescript
  tool("mecha_call", "Call another mecha bot", {
    bot: z.string().describe("Target bot name"),
    message: z.string().describe("Message to send"),
  }, async (args) => {
    const response = await callBot(args.bot, args.message);
    return { content: [{ type: "text", text: response }] };
  })
  ```
- [ ] `callBot()`: resolve `bot` → `http://mecha-${bot}:3000/prompt` (MagicDNS)
- [ ] HTTP POST, read SSE stream, collect full text response
- [ ] Handle 409 (busy) → return error text to calling bot
- [ ] Handle timeout/unreachable → error with bot name
- [ ] Update activity state to `calling` during call
- [ ] Log to `/state/logs/events.jsonl`: `{ type: "mecha_call", target, timestamp, duration, success }`

### 4.4 `mecha_list` tool (container)

Add to the existing `mechaToolServer` (created in Phase 3):

```
agent/tools/
└── mecha-list.ts              # tool handler, added to mecha-server.ts
```

**Tasks:**
- [ ] Add `mecha_list` tool to `mechaToolServer.tools[]`:
  ```typescript
  tool("mecha_list", "List available mecha bots on the network", {},
    async () => {
      const bots = await listBots();
      return { content: [{ type: "text", text: JSON.stringify(bots) }] };
    })
  ```
- [ ] Needs Headscale URL + API key — inject as env vars at spawn: `MECHA_HEADSCALE_URL`, `MECHA_HEADSCALE_API_KEY` (from `mecha.json`)
- [ ] Query Headscale API for nodes tagged `tag:mecha-bot`
- [ ] Return: `[{ name, node, status, model, ip }]`
- [ ] Model/schedule not available from Headscale — return only what's knowable (name, ip, online status). Bot can call the target's `/api/config` for details if needed.
- [ ] Fallback: if Headscale unavailable, return error with explanation

### 4.5 Multi-bot test

```bash
mecha auth add tailscale-main tskey-auth-...
mecha spawn researcher.yaml    # joins tailnet
mecha spawn reviewer.yaml      # joins tailnet
mecha spawn coordinator.yaml   # system prompt references the other two

mecha chat coordinator "Review the latest PR with research context"
# coordinator calls mecha_list, then mecha_call to each bot
```

**Milestone:** Bots discover each other and communicate over Tailscale mesh. ✓

---

## Phase 5: Scheduling & webhooks

**Goal:** Bots run on cron schedules and react to external events.

### 5.1 Scheduler (container)

```
agent/
└── scheduler.ts              # croner, internal cron loop
```

**Tasks:**
- [ ] Install croner
- [ ] Read schedule entries from bot config on boot
- [ ] For each entry: create cron job that calls the internal prompt handler directly (not HTTP — avoids self-request overhead)
- [ ] Concurrency: check busy lock before firing. If busy → skip, log as `skipped`
- [ ] Safety rails:
  - Daily run counter: max 50 runs/day per bot (reset at midnight UTC)
  - Per-run timeout: 10 min via `AbortController` + `Promise.race`
  - Consecutive error counter: auto-pause after 5 failures, log warning
  - Manual override: `POST /api/schedule/trigger/:id` bypasses daily limit
- [ ] Per-schedule state: nextRunAt, lastRunAt, runCount, runsToday, consecutiveErrors, status (active/paused)
- [ ] Persist schedule state to `/state/logs/schedule-state.json` (atomic write)
- [ ] `GET /api/schedule` → list jobs with state, next run, last result
- [ ] Stop all cron jobs on SIGTERM

### 5.2 Webhook handler (container)

```
agent/
└── webhook.ts                # allowlist filter + forward
```

**Tasks:**
- [ ] `POST /webhook` route
- [ ] Extract event type:
  - GitHub: `X-GitHub-Event` header + `action` body field → `pull_request.opened`
  - Generic: `type` field in body
- [ ] Check against `webhooks.accept` allowlist in config
- [ ] Miss → `204 No Content` (no API cost)
- [ ] Hit + busy → `429 Too Many Requests` with `Retry-After` header
- [ ] Hit + available → construct prompt, feed to query handler
- [ ] Payload size limit: reject > 100KB with `413`
- [ ] Optional webhook secret verification: if `webhooks.secret` in config, verify GitHub HMAC signature

### 5.3 CLI: expose flag

**Tasks:**
- [ ] `mecha spawn reviewer.yaml --expose 8080` → adds `-p 8080:3000` to docker run
- [ ] Show exposed port in `mecha ls` output

### 5.4 Test

```yaml
# ticker.yaml
name: ticker
system: "You say the current time and a fun fact."
schedule:
  - cron: "* * * * *"
    prompt: "What time is it? Share a fun fact."
```

```bash
mecha spawn ticker.yaml
mecha logs ticker -f
# Should see output every minute, skip if still processing
```

**Milestone:** Scheduled prompts fire autonomously. Webhooks filtered and forwarded. ✓

---

## Phase 6: Status API

**Goal:** Complete the bot status and observability surface. Powers the future pixel office and dashboard.

### 6.1 Activity state machine (container)

```
agent/
└── activity.ts               # state machine, emits changes
```

**Tasks:**
- [ ] States: `idle`, `thinking`, `calling`, `scheduled`, `webhook`, `error`
- [ ] Transitions driven by SDK message stream and tool callbacks:
  - Prompt received → `thinking`
  - `mecha_call` tool invoked (detected in MCP tool handler) → `calling`
  - `mecha_call` returned → `thinking`
  - `msg.type === "result"` → `idle`
  - Error → `error` → (auto) `idle`
  - Cron trigger → `scheduled` → `thinking`
  - Webhook trigger → `webhook` → `thinking`
- [ ] Option: use SDK `hooks.PreToolUse` callback to detect tool calls for state transitions
- [ ] EventEmitter for state changes (consumed by SSE stream and status endpoint)

### 6.2 Status routes (container)

**Tasks:**
- [ ] `GET /api/status` → `{ name, state, model, uptime, current_task, talking_to, last_active, schedule: { jobs, next_run } }`
- [ ] `GET /api/costs` → `{ task, today, lifetime }` buckets (from costs.ts)
- [ ] `GET /api/status/stream` → SSE stream, emits `state` and `cost` events on changes
- [ ] `GET /api/tasks` → list from index.json: `[{ id, created, status, summary }]`
- [ ] `GET /api/tasks/:id` → task detail (summary, timestamps, token usage)
- [ ] `GET /api/config` → bot config with auth keys redacted
- [ ] `GET /api/logs` → tail `/state/logs/events.jsonl` (last 100 entries), serves structured event history

**Milestone:** Full observability surface. Ready for dashboard and pixel office. ✓

---

## Phase 7: Dashboard

**Goal:** Fleet + bot dashboards accessible via `mecha dashboard`.

### 7.1 Bot dashboard (container)

```
agent/dashboard/
├── src/
│   ├── app.tsx
│   └── views/
│       ├── chat.tsx            # prompt input, SSE response stream
│       ├── tasks.tsx           # session list, conversation viewer
│       ├── schedule.tsx        # cron jobs, next run, last result
│       ├── logs.tsx            # event log viewer (from /api/logs)
│       └── config.tsx          # read-only config view
└── vite.config.ts
```

**Tasks:**
- [ ] Vite + React + Tailwind setup
- [ ] Chat view: POST /prompt, render SSE stream, show busy state
- [ ] Tasks view: GET /api/tasks, click to expand
- [ ] Schedule view: GET /api/schedule, show next run times, error counts
- [ ] Logs view: GET /api/logs (structured events, not Docker stdout)
- [ ] Config view: GET /api/config
- [ ] Build into container image, serve at `/dashboard/*`

### 7.2 Fleet dashboard (host)

```
dashboard/
├── src/
│   ├── app.tsx
│   └── views/
│       ├── fleet.tsx           # bot list, spawn form, quick actions
│       ├── network.tsx         # communication graph from event logs
│       └── auth.tsx            # profile management
└── vite.config.ts

src/
└── dashboard.ts               # Hono server: fleet API + proxy + static
```

**Tasks:**
- [ ] Fleet API server (Hono on host):
  - `GET /api/bots` → merge local docker ps + Headscale API for remote bots
  - `POST /api/bots` → spawn from posted config
  - `DELETE /api/bots/:name` → stop + rm
  - `POST /api/bots/:name/restart` → restart
  - `GET /api/auth` → list profiles
  - `POST /api/auth` → add profile
  - `GET /api/network` → aggregate `/api/logs` from all reachable bots
  - `GET /bot/:name/*` → proxy to bot via Tailscale IP or local docker inspect
- [ ] Fleet SPA: bot list with status/cost, spawn form, network map
- [ ] Embed SPA into CLI package
- [ ] `mecha dashboard [--port N]` → start server, open browser
- [ ] Proxy works because host is on the tailnet (set up in Phase 4)

### 7.3 Test

```bash
mecha dashboard
# Browser opens at localhost:7700
# See fleet overview with running bots
# Click reviewer → proxied to reviewer:3000/dashboard/
# Chat, view tasks, check schedule
```

**Milestone:** Web dashboard for fleet management and individual bot interaction. ✓

---

## Phase 8: Hardening

**Tasks:**
- [ ] Structured JSON logging to stdout with key redaction (`token`, `key`, `secret`, `password`, `authorization`)
- [ ] `MECHA_LOG_LEVEL` env var: debug, info, warn, error
- [ ] Webhook HMAC signature verification (GitHub webhook secret)
- [ ] `mecha auth swap <bot> <profile>` — stop, update config, restart with new env
- [ ] Bot token generation (`mecha_` + 24 random hex) for future host ↔ container auth
- [ ] README with quickstart guide
- [ ] `npm publish` setup + `npx mecha` support
- [ ] Integration test suite: spawn → chat → session persist → bot-to-bot → schedule → webhook → stop → start → verify state

---

## Phase Summary

| Phase | Delivers | Key files |
|-------|----------|-----------|
| 0 | Shared foundations (errors, safe-read, atomic-write, mutex, validation) | 5 |
| 1 | Container accepts prompts via HTTP/SSE | 3 + Dockerfile |
| 2 | CLI lifecycle + auth bootstrap (11 commands) | 5 |
| 3 | Session persistence (SDK-native) + cost tracking | 3 |
| 4 | Tailscale networking + bot-to-bot (s6, mecha_call, mecha_list) | 4 + Dockerfile v2 |
| 5 | Cron scheduling + webhooks | 2 |
| 6 | Status API (activity state, costs, tasks, events) | 2 |
| 7 | Fleet + bot dashboards | ~10 |
| 8 | Hardening (logging, webhook auth, tests, publish) | ~3 |

**Total: ~37 files.** Versus v1's 291 files across 14 packages.

## Dependency Graph

```
Phase 0 (foundations)
  └→ Phase 1 (container)
       └→ Phase 2 (CLI + auth)
            ├→ Phase 3 (sessions + costs)
            │    └→ Phase 5 (scheduling + webhooks)
            │         └→ Phase 6 (status API)
            │              └→ Phase 7 (dashboards)
            └→ Phase 4 (Tailscale + bot-to-bot)
                 └→ Phase 7 (dashboards — proxy needs tailnet)
                      └→ Phase 8 (hardening)
```

Phases 3-5 and Phase 4 can run in parallel after Phase 2.

## Codex Review Issues — Resolution

| Issue | Resolution |
|-------|------------|
| Session persistence conflicting sources of truth | SDK `.claude/` mount is the single source. `index.json` is metadata only. |
| `mecha_list` needs Headscale API key inside container | Inject as env vars: `MECHA_HEADSCALE_URL`, `MECHA_HEADSCALE_API_KEY` |
| Dashboard can't proxy to bots on tailnet | Host joins tailnet in Phase 4. Proxy uses Tailscale IP. |
| `mecha ls` columns not available from all sources | Phase 2: local only. Phase 4: add network columns. Model/schedule from registry.json, not live API. |
| Phase 1 includes s6+Tailscale unnecessarily | Moved to Phase 4. Phase 1 is single-process. |
| Core utilities in Phase 8 | Moved to Phase 0. |
| Auth deferred to Phase 6 | Moved to Phase 2 with env var fallback. |
| v1-reuse.md says single-machine | Stale — multi-machine is supported via Tailscale. |
| Webhook signature verification missing | Added optional `webhooks.secret` in Phase 5, full HMAC in Phase 8. |
| Busy behavior ambiguous | Specified: `/prompt` → 409, schedule → skip, webhook → 429 + Retry-After, CLI → show busy message. |
| Bot dashboard logs not implementable | Changed to `/api/logs` serving structured events from `/state/logs/`, not Docker stdout. |

## SDK Documentation Review — Fixes Applied

| Finding | Impact | Fix |
|---------|--------|-----|
| `bypassPermissions` requires `allowDangerouslySkipPermissions: true` | CRITICAL — query() would reject without it | Added to all query() call patterns across docs |
| Custom tools must use `createSdkMcpServer()` + `mcpServers` option | CRITICAL — `allowedTools` only filters built-in tools, cannot register custom ones | Rewrote Phase 3.2 and Phase 4.3/4.4 to use MCP server pattern |
| SDK yields 20+ message types, not just 3 | MEDIUM — SSE mapping was incomplete | Expanded Phase 1 message handling: `assistant` (BetaMessage content blocks), `tool_use_summary`, `tool_progress`, `result` |
| `assistant` message wraps `BetaMessage`, not plain text | MEDIUM — need to extract content blocks | Updated all streaming code to iterate `msg.message.content` blocks |
| `maxBudgetUsd` option exists for per-query cost limits | LOW — useful safety feature | Added `max_budget_usd` to bot config, wired into query() options |
| SDK hooks (`PreToolUse`, `Stop`, etc.) available as callbacks | LOW — useful for activity state tracking | Noted as option in Phase 6 activity state machine |
| V2 SDK (`unstable_v2_createSession`) exists but is unstable | INFO — stick with V1 `query()` for production | No change needed, our V1 approach is correct |
| `total_cost_usd` is per-query, not cumulative across calls | CONFIRMED — our accumulation approach is correct | No change needed |
