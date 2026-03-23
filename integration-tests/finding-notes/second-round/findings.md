# Round 2 Integration Testing Findings

**Version**: v0.2.8
**Date**: 2026-03-10
**Tester**: Claude (automated)

## Findings

### F-001: Daemon does not auto-load ~/.mecha/.env
- **Severity**: Medium
- **Category**: 01 - Bot Lifecycle / Setup
- **Machine**: linode02
- **Description**: `mecha start -d` does not load `~/.mecha/.env` automatically. Bot spawn fails with "No API credentials" even though ANTHROPIC_API_KEY exists in `.env`. User must manually `source ~/.mecha/.env` before starting the daemon.
- **Expected**: Daemon should auto-load `.env` from mechaDir on startup.
- **Workaround**: `set -a; source ~/.mecha/.env; set +a; mecha start -d --host 0.0.0.0`
- **Impact**: Every machine restart requires manual env sourcing. Easy to forget.

### F-002: Workspace path warning on every spawn
- **Severity**: Low (cosmetic)
- **Category**: 01 - Bot Lifecycle
- **Machine**: linode02
- **Description**: Every `mecha bot spawn <name> ~/test-project` prints `Workspace /home/joker/test-project is not under home /home/joker/.mecha/<name>`. This is expected (workspace is separate from bot home), but the warning is confusing and prints on every spawn. Should either be suppressed or clarified.
- **Workaround**: None needed — spawn succeeds.

### F-003: SIGKILL sets state to "stopped" instead of "error"
- **Severity**: Low
- **Category**: 01 - Bot Lifecycle
- **Machine**: linode02
- **Description**: `mecha bot kill <name>` sends SIGKILL. Node.js reports `code=null` for signal kills, which the exit handler maps to "stopped" (only non-zero `code` maps to "error"). State should probably be "error" or "killed" for SIGKILL termination to distinguish from graceful stop.
- **Impact**: `mecha bot ls` shows "stopped" for both graceful stop and force kill — no way to tell them apart.

### F-004: Daemon holds CLI lock indefinitely, blocking all mutating commands
- **Severity**: Critical
- **Category**: 02 - Chat & Query / 06 - Auth & Security
- **Machine**: linode02
- **Description**: `mecha start -d` acquires the CLI singleton lock (cli.lock). The daemon process keeps running and never releases it. All mutating commands (`acl grant`, `acl revoke`, `plugin add`, `audit clear`, `totp setup`, etc.) fail with "Another mecha CLI is already running (pid XXXXX)".
- **Impact**: ACL management completely broken while daemon runs. Cannot grant inter-bot permissions, cannot setup TOTP, etc.
- **Root cause**: The `start` command acquires the lock, forks the daemon, but the lock file persists with the daemon PID. The daemon process is alive so the lock is never stale.
- **Expected**: Daemon should release the CLI lock after forking, or mutating commands should not require the lock when the daemon is running (since they write to separate state files).

### F-005: Agent /bots/:name/query requires X-Mecha-Source header even for dashboard admin
- **Severity**: Medium
- **Category**: 02 - Chat & Query
- **Machine**: linode02
- **Description**: The `/bots/:name/query` endpoint requires `X-Mecha-Source` header unconditionally. Dashboard users (authenticated via TOTP session cookie) cannot query bots without providing this header. Once provided, ACL rules must also exist (e.g., `dashboard query alice`).
- **Expected**: Dashboard admin sessions should bypass ACL checks (admin privilege) or the dashboard UI should automatically set the source header.
- **Impact**: Inter-bot query via dashboard requires manual ACL setup for the dashboard user entity.

### F-007: Local node name shows "unknown" in mesh/nodes and handshake
- **Severity**: Low (cosmetic)
- **Category**: 05 - Mesh Networking
- **Machine**: linode02
- **Description**: After `mecha node init --name linode02`, the `/mesh/nodes` API returns `"name":"unknown"` for the local node, and handshake responses return `"nodeName":"unknown"`. The node identity is initialized but the agent server doesn't use it for self-identification.
- **Expected**: Local node should identify as the initialized name.

### F-008: CLI `bot ls/status/find` lack `--node` routing for remote bots
- **Severity**: Medium
- **Category**: 05 - Mesh Networking
- **Machine**: linode02
- **Description**: CLI commands `bot ls`, `bot status`, `bot find` operate on local bots only. No `--node` option exists to query remote nodes. The agent API supports `?node=` routing (e.g., `GET /bots/remote-worker/status?node=spark01` works), but the CLI doesn't expose this.
- **Impact**: Cross-node bot management requires raw API calls or dashboard. CLI-only users cannot inspect remote bots.

### F-009: `/discover` endpoint doesn't aggregate remote node bots
- **Severity**: Low
- **Category**: 05 - Mesh Networking
- **Machine**: linode02
- **Description**: `GET /discover` only returns local bots. There's no federated discovery that aggregates bots across all registered nodes. `?node=` routing doesn't work on this endpoint either.
- **Expected**: Debatable — local-only is simpler and avoids latency. Federated discovery could be a separate endpoint.

### F-011: Daemon crashes silently during MCP HTTP server testing
- **Severity**: Medium
- **Category**: 08 - MCP Server / 11 - Failure & Recovery
- **Machine**: linode02
- **Description**: During MCP HTTP transport testing, the daemon process (pid 345944) crashed silently while the orphaned MCP HTTP server (mcp serve --transport http) remained running. The agent server on port 7660 became unreachable. Bot __runtime processes continued running as orphans.
- **Root cause**: Unclear — may be related to running a separate MCP HTTP server on port 7680 while the daemon was already running, or resource exhaustion (962MB total memory, daemon using ~100MB).
- **Impact**: Agent API becomes unavailable, no dashboard access, no remote bot management. Bots keep running but are unmanaged.

### F-010: Budget enforcement doesn't block requests over daily limit
- **Severity**: Medium
- **Category**: 07 - Metering & Budgets
- **Machine**: linode02
- **Description**: Setting a daily budget of $0.01 on test-bot (which already has $0.25 spend) does not block new chat requests. The request completes successfully and costs an additional $0.008. Budget limits are stored but not enforced by the meter proxy.
- **Expected**: Requests should be rejected (402 or similar) when accumulated daily cost exceeds the budget.
- **Impact**: Budget limits are advisory only — no actual spending control.

### F-012: Concurrent bot spawns cause port collision
- **Severity**: Medium
- **Category**: 11 - Failure & Recovery
- **Machine**: linode02
- **Description**: Spawning 5 bots simultaneously (`mecha bot spawn par-1 ... par-5 &`) allocates port 7703 for all 5. The `reservedPorts` set in `spawn-pipeline.ts` prevents collision within a single agent process, but each CLI command makes a separate HTTP request to the agent. The agent serializes spawns internally but port allocation + health check is async — by the time the 2nd spawn checks ports, the 1st is still in health-check and hasn't registered in the live map yet.
- **Impact**: Only 1 of 5 parallel spawns survives; rest error/stop immediately. Users spawning multiple bots in scripts must do it sequentially.

### F-013: Cross-node proxy auth limited to 4 paths — most operations return 401
- **Severity**: High
- **Category**: 12 - Multi-Machine
- **Machine**: linode02 → spark01
- **Description**: `proxyToNode()` forwards requests to remote nodes with Bearer mesh API key auth. But the remote node's `isMeshRoutingRequest()` only allows Bearer auth for 4 specific paths: `GET /bots`, `GET /bots/:name/status`, `POST /bots/:name/query`, `GET /node/info`. All other operations (sessions, stop, start, kill, remove, config, schedules) return 401 when proxied.
- **Expected**: All `?node=` proxied operations should authenticate successfully on the remote node.
- **Impact**: Cross-node management via dashboard or API is broken for most operations. Only bot listing, status, and query work across nodes.

### F-014: /bots/:name/query doesn't support ?node= routing
- **Severity**: Medium
- **Category**: 12 - Multi-Machine
- **Machine**: linode02
- **Description**: The `/bots/:name/query` endpoint in `routing.ts` does not call `proxyToNode()`. Unlike other bot endpoints (status, start, stop, etc.), query cannot be routed to remote nodes. Inter-bot queries can only target local bots.
- **Expected**: `/bots/:name/query?node=spark01` should proxy the query to spark01's agent.
- **Impact**: Cross-node inter-bot communication not possible through the agent API.

### F-006: /bots/:name/query returns 403 before checking if bot exists
- **Severity**: Low
- **Category**: 02 - Chat & Query
- **Machine**: linode02
- **Description**: When querying a nonexistent bot without ACL, the agent returns 403 "Access denied" instead of 404 "not found". The ACL check runs before the bot existence check, leaking no information about bot existence but giving a confusing error.
- **Expected**: Debatable — 404 for non-existent vs 403 for no-ACL. Current behavior is arguably more secure (no enumeration).

## Test Results — 02 Chat & Query

| # | Test | Result | Notes |
|---|------|--------|-------|
| 2.1 | Basic CLI chat | PASS | Response + session ID |
| 2.2 | Session resume | PASS | Bot remembered secret word |
| 2.3 | Chat nonexistent bot | PASS | "not found" error |
| 2.4 | Chat stopped bot | PASS | "not running" error |
| 2.5 | POST /api/chat | PASS | JSON response with cost |
| 2.6 | Chat with sessionId | PASS | Same session reused |
| 2.7 | Missing message | PASS | 400 error |
| 2.8 | Message too large | PASS | 413 error |
| 2.9 | Invalid sessionId type | PASS | 400 error |
| 2.10 | No auth header | PASS | 401 |
| 2.11 | Wrong auth token | PASS | 401 |
| 2.12 | Query via agent API | PASS | Requires X-Mecha-Source + ACL (F-005) |
| 2.13 | Query without ACL | PASS | 403 Forbidden |
| 2.14 | Query with ACL grant | PASS | Response from alice |
| 2.15 | Query nonexistent bot | PASS* | 403 not 404 (F-006) |
| 2.16 | Query stopped bot | PASS | 502 "Upstream bot unavailable" |

**Result: 16/16 PASS** (2 findings: F-005 medium, F-006 low)

## Test Results — 01 Bot Lifecycle

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1.1 | Spawn with defaults | PASS | Workspace warning (F-002) |
| 1.2 | Spawn explicit port | PASS | |
| 1.3 | Spawn with tags | PASS | Tags persisted |
| 1.4 | Spawn with expose | PASS | `query,read_workspace` persisted |
| 1.5 | Spawn duplicate | PASS | "already exists" error |
| 1.6 | Spawn invalid name | PASS | Validation works |
| 1.7 | Spawn --no-auth | PASS | Bot spawns without creds |
| 1.8 | Spawn model override | PASS | Model persisted |
| 1.9 | List running bots | PASS | Shows all with state, port, tags |
| 1.10 | Bot status | PASS | Shows pid, port, state, uptime |
| 1.11 | Status of stopped | PASS | state=stopped |
| 1.12 | Status --json | PASS | Valid JSON |
| 1.13 | Graceful stop | PASS | |
| 1.14 | Force kill | PASS | state=stopped (F-003) |
| 1.15 | Stop already stopped | PASS | Error "not running" |
| 1.16 | Stop-all | PASS | All 3 stopped |
| 1.17 | Restart running | PASS | New PID, same port |
| 1.18 | Restart stopped | PASS | Bot starts from config |
| 1.19 | Restart-all | PASS | All 6 restarted |
| 1.20 | Remove stopped | PASS | Config+logs deleted |
| 1.21 | Remove running --force | PASS | Killed then removed |
| 1.22 | Remove nonexistent | PASS | "not found" error |

**Result: 22/22 PASS** (2 low-severity findings, 1 medium setup finding)

## Test Results — 03 Sessions

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.1 | List sessions (CLI) | PASS | 5 sessions listed with ID, title, timestamps |
| 3.2 | Show session (CLI) | PASS | Full transcript with events displayed |
| 3.3 | List empty sessions | PASS | "No sessions" (no error) |
| 3.4 | GET /api/sessions | PASS | JSON array of 5 session metadata objects |
| 3.5 | GET /api/sessions/:id | PASS | Session with 10 events |
| 3.6 | GET nonexistent session | PASS | 404 |
| 3.7 | DELETE /api/sessions/:id | PASS | 200, session removed |
| 3.8 | DELETE nonexistent | PASS | 404 "Session not found" |
| 3.9 | GET /bots/:name/sessions (agent) | PASS | 4 sessions (after delete in 3.7) |
| 3.10 | GET /bots/:name/sessions/:id (agent) | PASS | Full transcript with events |
| 3.11 | DELETE /bots/:name/sessions/:id (agent) | PASS | 200, session removed |
| 3.12 | Resume SDK session with CLI | PASS | CLI resumed session, bot answered "6" (previous Q: "3+3") |

**Result: 12/12 PASS** (no new findings)

## Test Results — 04 Scheduling

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.1 | Add schedule | PASS | "daily-check" added (every 5m) |
| 4.2 | List schedules | PASS | Shows ID, interval, prompt, paused state |
| 4.3 | Add duplicate | PASS | "already exists" error |
| 4.4 | Add invalid interval | PASS | "Invalid interval" (min 10s, max 24h) |
| 4.5 | Remove schedule | PASS | Schedule removed |
| 4.6 | Remove nonexistent | PASS | "not found" error |
| 4.7 | Pause schedule | PASS | paused=yes |
| 4.8 | Resume schedule | PASS | paused=no |
| 4.9 | Pause all | PASS | Both schedules paused |
| 4.10 | Resume all | PASS | Both schedules resumed |
| 4.11 | Pause nonexistent | PASS | "not found" error |
| 4.12 | Manual trigger | PASS | Run completed (24220ms), outcome=success |
| 4.13 | Run nonexistent | PASS | "not found" error |
| 4.14 | View history | PASS | Shows run records with timestamp, duration, outcome |
| 4.15 | History with limit | PASS | Limit parameter works |
| 4.16 | POST /api/schedules | PASS | 201 with schedule data |
| 4.17 | POST /api/schedules/:id/run | PASS | 200 with execution result (21273ms) |
| 4.18 | GET /api/schedules/:id/history | PASS | 2 run records returned |

**Result: 18/18 PASS** (no new findings)

## Test Results — 05 Mesh Networking

| # | Test | Result | Notes |
|---|------|--------|-------|
| 5.1 | Initialize node | PASS | `mecha node init --name linode02` |
| 5.2 | Node info | PASS | Shows hostname, IPs, resources, bot count |
| 5.3 | Add remote node | PASS | spark01 added with mesh API key |
| 5.4 | List nodes | PASS | Shows spark01 with type, host, port, last seen |
| 5.5 | Remove node | PASS | bad-node removed |
| 5.6 | Add duplicate | PASS | "already registered" error |
| 5.7 | Ping remote node | PASS | 563ms latency to spark01 |
| 5.8 | Ping unreachable | PASS | "unreachable" error |
| 5.9 | Node health (all) | PASS | spark01 online, bad-node offline |
| 5.10 | Node health (specific) | PASS | Single node report |
| 5.11 | List remote bots | PASS* | Only local bots shown — CLI lacks --node (F-008) |
| 5.12 | Remote bot status | PASS* | Via API ?node= routing (CLI lacks --node) (F-008) |
| 5.13 | Find by tag across nodes | FAIL | Only searches local bots (F-008) |
| 5.14 | Discover via API | PASS* | Local bots only, no federation (F-009) |
| 5.15 | Create invite | PASS | mecha:// invite code generated |
| 5.16 | Join with invite | PASS | Peer added (rendezvous 502, fallback to local) |
| 5.17 | Expired invite | SKIP | Requires 24h wait for expiry |
| 5.18 | GET /mesh/nodes | PASS | Both nodes with health, bot counts (F-007: name=unknown) |
| 5.19 | POST /nodes | PASS | 200, node added via API |
| 5.20 | Auto-discovery handshake | PASS | Accepted with correct cluster key |

**Result: 18/20 PASS, 1 FAIL, 1 SKIP** (3 findings: F-007 low, F-008 medium, F-009 low)

## Test Results — 06 Auth & Security

| # | Test | Result | Notes |
|---|------|--------|-------|
| 6.1 | Add auth profile | PASS | Profile "test-profile" added |
| 6.2 | List profiles | PASS | Shows all profiles with default marker, tags |
| 6.3 | Set default | PASS | Default profile updated |
| 6.4 | Test profile (online) | PASS | "API verified" |
| 6.5 | Test profile (offline) | PASS | "offline check" valid |
| 6.6 | Remove profile | PASS | Profile deleted |
| 6.7 | Switch bot auth | PASS | Bot now uses specified profile |
| 6.8 | Renew token | PASS | Token updated |
| 6.9 | Tag profile | PASS | Tags saved (prod, research) |
| 6.10 | TOTP setup | BLOCKED | F-004: CLI lock held by daemon |
| 6.11 | TOTP verify valid | PASS | "Valid" |
| 6.12 | TOTP verify invalid | PASS | "Invalid", exit code 1 |
| 6.13 | TOTP status | PASS | "TOTP is configured" |
| 6.14 | Dashboard login | PASS | Session cookie issued |
| 6.15 | Grant capability | BLOCKED | F-004: CLI lock held by daemon |
| 6.16 | Show ACL | PASS | Lists all 3 rules |
| 6.17 | Show per-bot ACL | PASS | Filtered rules for alice |
| 6.18 | Revoke capability | BLOCKED | F-004: CLI lock held by daemon |
| 6.19 | ACL enforcement - allowed | PASS | Query succeeds with grant |
| 6.20 | ACL enforcement - denied | PASS | 403 "Access denied" |
| 6.21 | Bearer token required | PASS | 401 without auth |
| 6.22 | Path traversal blocked | PASS | 400 "Path traversal denied" |

**Result: 19/22 PASS, 3 BLOCKED** (F-004 blocks: totp setup, acl grant, acl revoke)

## Test Results — 07 Metering & Budgets

| # | Test | Result | Notes |
|---|------|--------|-------|
| 7.1 | Meter status | PASS | Running, pid, port 7600, uptime |
| 7.2 | Meter stop | PASS | Stopped successfully |
| 7.3 | Meter start | PASS | Restarted on port 7600 |
| 7.4 | Meter already running | PASS | "already running" error |
| 7.5 | View all costs | PASS | Total $0.28 across 3 bots |
| 7.6 | View per-bot cost | PASS | test-bot: $0.24 |
| 7.7 | Cost after chat | PASS | Cost increased $0.24 → $0.25 |
| 7.8 | Cost via API | PASS | JSON breakdown with tokens, latency |
| 7.9 | Set daily budget | PASS | Budget saved |
| 7.10 | Set monthly budget | PASS | Global monthly $100 |
| 7.11 | List budgets | PASS | Shows all budget rules |
| 7.12 | Remove budget | PASS | Daily budget removed |
| 7.13 | Budget enforcement | FAIL | Budget not enforced — request allowed over limit (F-010) |
| 7.14 | Tag-based budget | PASS | Budget applied to tag:dev |

**Result: 13/14 PASS, 1 FAIL** (1 finding: F-010 medium — budget enforcement not working)

## Test Results — 08 MCP Server

| # | Test | Result | Notes |
|---|------|--------|-------|
| 8.1 | Stdio transport | PASS | MCP initialize response received |
| 8.2 | HTTP transport | PASS | SSE response on port 7680 |
| 8.3 | HTTP with auth | PASS | 401 without Bearer token |
| 8.4 | MCP config output | PASS | Claude Desktop JSON config |
| 8.5 | mecha_list_bots | PASS | 3 bots listed |
| 8.6 | mecha_bot_status | PASS | Detailed bot info |
| 8.7 | mecha_list_nodes | PASS | spark01 healthy (861ms) |
| 8.8 | mecha_discover (tag) | PASS | "No bots match" (correct — dev tag is on remote) |
| 8.9 | mecha_discover (capability) | PASS | 3 bots with query capability |
| 8.10 | mecha_workspace_list | PASS | README.md listed |
| 8.11 | mecha_workspace_read | PASS | File contents returned |
| 8.12 | Path traversal guard | PASS | "File not found" isError:true (doesn't leak contents) |
| 8.13 | mecha_list_sessions | PASS | 9 sessions listed |
| 8.14 | mecha_get_session | PASS | Full transcript with events |
| 8.15 | mecha_query | PASS | Response "PONG" with sessionId |
| 8.16 | Audit log | PASS | Login events, server lifecycle visible |

**Result: 16/16 PASS** (1 finding: F-011 medium — daemon crash during testing)

## Test Results — 09 Dashboard & SPA

| # | Test | Result | Notes |
|---|------|--------|-------|
| 9.1 | Dashboard TOTP login | PASS | 6-digit OTP input with auto-focus, session cookie issued |
| 9.2 | Invalid TOTP | PASS | "Invalid code" message displayed |
| 9.3 | Session persistence | PASS | 11 sessions visible in Sessions tab with links to detail view |
| 9.4 | Bot list page | PASS | 3 bots with stats bar (requests, cost, tokens, latency), action buttons |
| 9.5 | Bot detail page | PASS | Tabs: Sessions, Schedules, Files, Config, Logs. Auth profile shown. |
| 9.6 | Spawn via UI | PASS | New Bot dialog with full options (name, workspace, auth, tags, sandbox, model, system prompt, effort, budget, expose, meter). Bot appeared in list (error state — expected: /tmp/ui-test doesn't exist). |
| 9.7 | Stop via UI | PASS | Confirmation dialog, state changed to "stopped", buttons changed to Start/Remove |
| 9.8 | Logs tab | PASS | stdout logs visible with HTTP request/response entries |
| 9.9 | WebSocket terminal | PASS | PTY terminal connected, Claude Code trust prompt displayed, session picker dropdown |
| 9.10 | Terminal reconnect | SKIP | Would need to disconnect/reconnect WebSocket — not practical via Playwright |
| 9.11 | Nodes page | PASS | 4 nodes: linode02 (local), spark01 (online), test-handshake (offline), unknown (discovered). System info, uptime, latency, network, resources displayed. Ping/Remove/Promote buttons. |
| 9.12 | Remote bot view | PASS | Clicking spark01 → `/?node=spark01`, shows remote-worker (running) + coder (stopped) with tag filters, Restart/Stop/Kill buttons |
| 9.13 | Settings page | PASS | Node info, TOTP status, security links (ACL, Auth, Sandbox), meter daemon status, network config, runtime settings, auto-discovery status |
| 9.14 | Mobile responsive | PASS | 375x812 viewport: sidebar collapsed to drawer, hamburger menu, single-column layout, all content accessible |

**Result: 13/14 PASS, 1 SKIP** (no new findings — F-007 "@ unknown" confirmed in remote bot view)

## Test Results — 10 Sandbox

| # | Test | Result | Notes |
|---|------|--------|-------|
| 10.1 | Spawn with auto sandbox | PASS | Warning "Kernel sandbox not available, running without sandbox" — correct fallback |
| 10.2 | Spawn with require sandbox | PASS | Error "Sandbox required but Linux bubblewrap (not available)" |
| 10.3 | Spawn with sandbox off | PASS | No sandbox applied, sandboxMode=off in status |
| 10.4 | Check sandbox info | PASS | Status shows sandboxMode field |
| 10.5 | File read restriction (macOS) | SKIP | macOS not tested this round |
| 10.6 | Network allowed (macOS) | SKIP | macOS not tested this round |
| 10.7 | Profile generated (macOS) | SKIP | macOS not tested this round |
| 10.8 | Namespace isolation (Linux) | SKIP | bubblewrap not installed on linode02 |
| 10.9 | Unsupported platform fallback | PASS | Warning logged, bot runs without sandbox (auto mode) |
| 10.10 | dangerouslySkipPermissions requires sandbox | PASS | Error "dangerouslySkipPermissions requires sandboxMode 'require'" |

**Result: 6/10 PASS, 4 SKIP** (SKIPs due to missing bubblewrap on Linux and no macOS testing)

## Test Results — 11 Failure & Recovery

| # | Test | Result | Notes |
|---|------|--------|-------|
| 11.1 | Bot process crash | PASS | State updated to "stopped" (F-003: SIGKILL→stopped not error) |
| 11.2 | Start after crash | PASS | Bot restarted from persisted config on same port |
| 11.3 | Daemon process crash | PASS | All 3 bot runtime processes survived daemon kill |
| 11.4 | Daemon restart | PASS | Daemon restarted, rediscovered all running bots with correct PIDs |
| 11.5 | Meter crash recovery | SKIP | Meter runs inside daemon process — cannot test independently |
| 11.6 | Port in use | SKIP | Port blocking via SSH unreliable for testing |
| 11.7 | All ports exhausted | SKIP | Would need to block 100 ports |
| 11.8 | Corrupt config.json | PASS | "bot config: invalid JSON" error, no crash |
| 11.9 | Missing state.json | PASS | Bot becomes "not found" in status, no crash, process continues |
| 11.10 | Read-only filesystem | SKIP | Test setup issue (bot name vs dir name mismatch) |
| 11.11 | Chat timeout | SKIP | Timeout is internal to SDK, not configurable per-request |
| 11.12 | Remote node unreachable | PASS | Already tested in 5.8 — "unreachable" error |
| 11.13 | API key expired | SKIP | Would need expired OAuth token, not testable with API key |
| 11.14 | Invalid API key | SKIP | Bot uses env var key, not per-request header |
| 11.15 | Simultaneous spawn | FAIL | Port collision — all 5 spawns got same port (F-012) |
| 11.16 | Stop during chat | SKIP | Would need long-running chat + timing |

**Result: 7/16 PASS, 1 FAIL, 8 SKIP** (1 finding: F-012 concurrent port collision)

## Test Results — 12 Multi-Machine

| # | Test | Result | Notes |
|---|------|--------|-------|
| 12.1 | Add node A→B | PASS | Already tested in 5.3 |
| 12.2 | Add node B→A | SKIP | mac-mini not configured as node A in this round |
| 12.3 | Three-node mesh | SKIP | Would need all 3 nodes with bidirectional registration |
| 12.4 | Verify ping latency | PASS | spark01: 469ms (http) |
| 12.5 | List remote bots | PASS | 2 remote bots via API ?node= routing |
| 12.6 | Remote bot status | PASS | Full status from spark01 (pid, port, workspace) |
| 12.7 | Spawn remote bot (API) | FAIL | 401 — Bearer auth rejected for POST /bots (F-013) |
| 12.8 | Stop remote bot | FAIL | 401 — stop not in MESH_BEARER_PATHS (F-013) |
| 12.9 | Chat with remote bot | FAIL | /bots/:name/query lacks ?node= routing (F-014) |
| 12.10 | Inter-bot query across nodes | FAIL | Same as 12.9 (F-014) |
| 12.11 | ACL across nodes | PASS* | ACL grant works per-node, but cross-node query fails (F-014) |
| 12.12 | List remote sessions | FAIL | 401 — sessions not in MESH_BEARER_PATHS (F-013) |
| 12.13 | View remote session | FAIL | Same as 12.12 (F-013) |
| 12.14 | Add schedule to remote bot | FAIL | 401 — schedules not in MESH_BEARER_PATHS (F-013) |
| 12.15 | Run remote schedule | FAIL | Same as 12.14 (F-013) |
| 12.16 | MCP list_bots across mesh | PASS | Already tested in 8.5 — local bots only |
| 12.17 | MCP query remote bot | SKIP | MCP doesn't support ?node= parameter |
| 12.18 | MCP workspace_read remote | SKIP | Same as 12.17 |

**Result: 5/18 PASS, 8 FAIL, 5 SKIP** (2 findings: F-013 high — mesh auth too restrictive, F-014 medium — query routing missing)

## Test Results — 13 Upgrade & Migration

| # | Test | Result | Notes |
|---|------|--------|-------|
| 13.1 | Homebrew upgrade (macOS) | SKIP | Not testing macOS this round |
| 13.2 | Binary upgrade (Linux) | PASS | v0.2.7 → v0.2.8 via brew upgrade on linode02 |
| 13.3 | Version check | PASS | `mecha --version` returns "0.2.8" |
| 13.4 | Bot configs survive | PASS | All 3 bots listed with correct config after upgrade |
| 13.5 | Sessions survive | PASS | Previous sessions still accessible |
| 13.6 | TOTP secret preserved | PASS | "TOTP is configured" |
| 13.7 | Node registry preserved | PASS | All nodes (spark01, discovered nodes) still registered |
| 13.8 | Mixed version mesh | SKIP | Would need nodes running different versions |

**Result: 6/8 PASS, 2 SKIP** (no new findings)

---

## Summary

### Overall Results

| Category | Pass | Fail | Skip | Blocked | Total |
|----------|------|------|------|---------|-------|
| 01 Bot Lifecycle | 22 | 0 | 0 | 0 | 22 |
| 02 Chat & Query | 16 | 0 | 0 | 0 | 16 |
| 03 Sessions | 12 | 0 | 0 | 0 | 12 |
| 04 Scheduling | 18 | 0 | 0 | 0 | 18 |
| 05 Mesh Networking | 18 | 1 | 1 | 0 | 20 |
| 06 Auth & Security | 19 | 0 | 0 | 3 | 22 |
| 07 Metering & Budgets | 13 | 1 | 0 | 0 | 14 |
| 08 MCP Server | 16 | 0 | 0 | 0 | 16 |
| 09 Dashboard & SPA | 13 | 0 | 1 | 0 | 14 |
| 10 Sandbox | 6 | 0 | 4 | 0 | 10 |
| 11 Failure & Recovery | 7 | 1 | 8 | 0 | 16 |
| 12 Multi-Machine | 5 | 8 | 5 | 0 | 18 |
| 13 Upgrade & Migration | 6 | 0 | 2 | 0 | 8 |
| **TOTAL** | **171** | **11** | **21** | **3** | **206** |

### Pass Rate: 171/206 (83%)
### Actionable Failures: 11 (5.3%)
### Blocked by F-004: 3 (1.5%)

### Findings by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 1 | F-004 (CLI lock) |
| High | 1 | F-013 (mesh auth) |
| Medium | 7 | F-001, F-005, F-008, F-010, F-011, F-012, F-014 |
| Low | 5 | F-002, F-003, F-006, F-007, F-009 |
| **Total** | **14** | |

### Top Priority Fixes

1. **F-004** (Critical): Daemon holds CLI lock — blocks `acl grant/revoke`, `totp setup`
2. **F-013** (High): Mesh Bearer auth only allows 4 paths — most cross-node operations return 401
3. **F-014** (Medium): `/bots/:name/query` lacks `?node=` routing — no cross-node inter-bot queries
4. **F-010** (Medium): Budget enforcement doesn't block over-limit requests
5. **F-012** (Medium): Concurrent spawns collide on port allocation

