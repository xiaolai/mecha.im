# Round 8 Testing Matrix — v0.2.14

**Target version**: v0.2.14
**Focus areas**: R7-004 fix verification, open R7 bugs deep-dive, undertested categories, regression sweep

## Open Bugs From Previous Rounds

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| R7-001 | HIGH | OPEN | macOS Seatbelt blocks SDK chat (posix_spawn EPERM) |
| R7-002 | MEDIUM | OPEN | systemPrompt not applied in compiled binary |
| R7-003 | LOW | OPEN | SSE events not delivered for bot lifecycle |
| R7-004 | MEDIUM | FIXED (v0.2.14) | Concurrent port collision race |
| R6-001 | CRITICAL | FIXED (v0.2.13) | cli.lock blocks daemon-proxied commands |
| R6-002 | HIGH | FIXED (v0.2.13) | ACL wildcard `*` rules ignored |
| R6-003 | HIGH | FIXED (v0.2.13) | Sandbox dedup loses symlink paths |
| R6-004 | HIGH | FIXED (v0.2.13) | systemPrompt not passed to SDK query |

---

## Section A: Fix Verification (5 tests)

Verify R7-004 fix and confirm previous fixes haven't regressed.

### FV-01: R7-004 concurrent port allocation — FIXED

**Goal**: Confirm atomic port allocation prevents race condition.

```bash
# Spawn 5 bots concurrently without explicit ports
for i in $(seq 1 5); do mecha bot spawn "race-$i" . & done; wait
mecha bot ls
# EXPECT: All 5 bots get unique ports, all in "running" state
# Verify ports are distinct:
mecha bot ls --json | jq '.[].port' | sort -u | wc -l  # should be 5
```

**Cleanup**: `for i in $(seq 1 5); do mecha bot stop "race-$i"; done`

### FV-02: Port 0 truthiness fix

**Goal**: Confirm `spawnOpts.port !== undefined` change doesn't break explicit port assignment.

```bash
mecha bot spawn explicit-port . --port 7710
mecha bot ls  # EXPECT: port 7710
mecha bot stop explicit-port
```

### FV-03: R6-001 cli.lock — no regression

**Goal**: Confirm mutating CLI commands still work while daemon running.

```bash
mecha start --daemon
mecha bot spawn locktest .
mecha plugin add some-plugin  # or any mutating command
mecha bot stop locktest
# EXPECT: All succeed without "Another mecha CLI is already running"
```

### FV-04: R6-002 ACL wildcard — no regression

**Goal**: Confirm wildcard ACL rules work.

```bash
mecha bot spawn acl-target . --port 7720
mecha bot spawn acl-source . --port 7721
mecha acl grant '*' query acl-target
mecha acl check acl-source query acl-target  # EXPECT: "allowed"
```

### FV-05: R6-003 sandbox dedup — no regression

**Goal**: Confirm sandbox profile includes both symlink and resolved paths.

```bash
mecha bot spawn sandbox-check . --sandbox auto
cat ~/mecha-camp/sandbox-check/sandbox-profile.json | jq '.profile.allowedProcesses'
# EXPECT: Contains both /Users/joker/.local/bin/claude AND resolved version path
mecha bot stop sandbox-check
```

---

## Section B: Open Bug Deep-Dive (6 tests)

### OB-01: R7-001 sandbox EPERM — isolate root cause

**Goal**: Determine exactly what the Seatbelt profile is blocking.

```bash
# Step 1: Spawn with sandbox auto, attempt chat
mecha bot spawn sb-test . --sandbox auto
curl -s -X POST http://localhost:$(mecha bot ls --json | jq -r '.[] | select(.name=="sb-test") | .port')/api/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(jq -r .token ~/mecha-camp/sb-test/config.json)" \
  -d '{"message":"hello"}'
# EXPECT: 500 with EPERM

# Step 2: Check what sandbox-exec reports
cat ~/mecha-camp/sb-test/logs/stderr.log | grep -i "deny\|sandbox\|eperm"

# Step 3: Test with relaxed profile — add /tmp write access
# Manually edit sandbox-profile.json to add (allow file-write* (subpath "/tmp"))
# Restart and retry
```

### OB-02: R7-001 — test with explicit process-exec allow-all

**Goal**: Determine if process-exec is the only blocker.

```bash
# Create bot with sandbox off, then manually wrap with minimal profile
mecha bot spawn sb-minimal . --sandbox off --port 7730
# Create SBPL with (allow process-exec*) but strict file access
# Run sandbox-exec -p /path/to/minimal.sb -- /path/to/runtime
# Attempt chat and observe which rules are hit
```

### OB-03: R7-002 systemPrompt — binary vs source comparison

**Goal**: Isolate whether the issue is Bun compilation or SDK version.

```bash
# Test 1: Run via source (not compiled binary)
cd packages/runtime && bun src/main.ts
# Set MECHA_SANDBOX_ROOT to a bot dir with systemPrompt in config.json
# Attempt chat — does systemPrompt work?

# Test 2: Check SDK version in compiled binary
mecha --version
bun pm ls | grep claude-agent-sdk

# Test 3: Direct SDK test
cat <<'JS' > /tmp/sdk-test.js
const { query } = require("@anthropic-ai/claude-agent-sdk");
query({ prompt: "say exactly: PIRATE", systemPrompt: "You are a pirate. Always respond as a pirate." })
  .then(r => console.log(r.text));
JS
node /tmp/sdk-test.js
# EXPECT: Pirate-themed response
```

### OB-04: R7-002 — inspect compiled runtime env vars

**Goal**: Check if systemPrompt is passed through env to the runtime.

```bash
mecha bot spawn prompt-test . --system-prompt "You are a pirate"
cat ~/mecha-camp/prompt-test/config.json | jq '.systemPrompt'
# EXPECT: "You are a pirate"

# Check if runtime reads it:
cat ~/mecha-camp/prompt-test/logs/stderr.log | grep -i "systemPrompt\|system_prompt\|pirate"
```

### OB-05: R7-003 SSE events — trace event path

**Goal**: Determine why ProcessManager events don't reach SSE endpoint.

```bash
# Terminal 1: Listen to SSE
curl -N http://localhost:7660/events -H "Authorization: Bearer $(cat ~/mecha-camp/totp-secret | head -1)"

# Terminal 2: Spawn and stop a bot
mecha bot spawn sse-test . --port 7740
sleep 3
mecha bot stop sse-test

# Terminal 1 should show:
#   data: {"type":"spawned","name":"sse-test","pid":...,"port":7740}
#   data: {"type":"stopped","name":"sse-test",...}
# EXPECT (current): Only heartbeats, no lifecycle events
```

### OB-06: R7-003 — verify daemon-spawned bots emit events

**Goal**: Test if bots spawned via daemon API (not CLI) emit SSE events.

```bash
# Use daemon API directly instead of CLI
curl -X POST http://localhost:7660/bots \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ..." \
  -d '{"name":"api-spawn","workspacePath":"."}'

# Check SSE stream from Terminal 1
# If events appear: problem is CLI spawns bypass daemon ProcessManager
# If no events: problem is in SSE subscription wiring
```

---

## Section C: Undertested Categories (8 tests)

These categories have had minimal or no testing in rounds 4-7.

### UT-01: MCP server — standalone HTTP transport

**Category**: 08-mcp-server

```bash
mecha mcp serve --transport http --port 7682
# In another terminal:
curl http://localhost:7682/health  # EXPECT: 200
# Send an MCP request (list tools):
curl -X POST http://localhost:7682 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# EXPECT: JSON-RPC response with tool list
```

### UT-02: MCP server — mecha_query tool

**Category**: 08-mcp-server

```bash
# Spawn a bot first
mecha bot spawn mcp-target . --port 7750
# Then use MCP mecha_query:
curl -X POST http://localhost:7682 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mecha_query","arguments":{"bot":"mcp-target","message":"hello"}}}'
# EXPECT: Query result from bot (or clean error if chat not working)
```

### UT-03: Failure recovery — bot crash restart

**Category**: 11-failure-recovery

```bash
mecha bot spawn crash-test . --port 7760
# Force-kill the bot process
kill -9 $(mecha bot ls --json | jq -r '.[] | select(.name=="crash-test") | .pid')
sleep 2
mecha bot ls  # EXPECT: state = "error" with exitCode info
mecha bot start crash-test  # EXPECT: Restarts successfully
mecha bot ls  # EXPECT: state = "running"
```

### UT-04: Failure recovery — daemon crash recovery

**Category**: 11-failure-recovery

```bash
mecha start --daemon
mecha bot spawn survive-test . --port 7770
# Kill daemon
kill $(cat ~/mecha-camp/daemon.pid)
sleep 2
# Restart daemon
mecha start --daemon
mecha bot ls  # EXPECT: survive-test shows up with recovered state
```

### UT-05: Budget enforcement — clean error on exceeded budget

**Category**: 07-metering-budgets

```bash
mecha meter start
mecha bot spawn budget-test . --port 7780
mecha budget set budget-test --daily 0.001
# Attempt chat
curl -X POST http://localhost:$(mecha bot ls --json | jq -r '.[] | select(.name=="budget-test") | .port')/api/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(jq -r .token ~/mecha-camp/budget-test/config.json)" \
  -d '{"message":"hello"}'
# EXPECT: Clean error message about budget exceeded, NOT a hang/timeout
```

### UT-06: Budget enforcement — per-auth-profile budget

**Category**: 07-metering-budgets

```bash
mecha budget set --auth-profile default --daily 0.50
mecha meter status  # EXPECT: Shows budget for auth profile
```

### UT-07: Expose mode — bind to 0.0.0.0

**Category**: 01-bot-lifecycle

```bash
mecha bot spawn exposed-bot . --port 7790 --expose
# Verify listening on all interfaces:
lsof -i :7790  # EXPECT: *:7790 (not 127.0.0.1:7790)
# Verify health from another machine (if available):
curl http://$(hostname):7790/healthz  # EXPECT: 200
mecha bot stop exposed-bot
```

### UT-08: Bot with custom model

**Category**: 01-bot-lifecycle

```bash
mecha bot spawn model-test . --port 7791 --model claude-sonnet-4-5-20250514
cat ~/mecha-camp/model-test/config.json | jq '.model'
# EXPECT: "claude-sonnet-4-5-20250514"
# Attempt chat — should use specified model
mecha bot stop model-test
```

---

## Section D: Stress & Edge Cases (5 tests)

### SE-01: Rapid spawn-stop cycle

**Goal**: Test for resource leaks in port allocation/release.

```bash
for i in $(seq 1 10); do
  mecha bot spawn "cycle-$i" . && mecha bot stop "cycle-$i"
done
mecha bot ls  # EXPECT: All stopped cleanly, no zombies
# Check port range isn't exhausted:
mecha bot spawn final-check . && mecha bot ls && mecha bot stop final-check
```

### SE-02: Spawn with all config options

**Goal**: Verify complex config doesn't crash.

```bash
mecha bot spawn kitchen-sink . \
  --port 7792 \
  --model claude-sonnet-4-5-20250514 \
  --tags "test,kitchen-sink" \
  --sandbox off \
  --permission-mode default
cat ~/mecha-camp/kitchen-sink/config.json | jq '.'
# EXPECT: All options reflected in config
mecha bot stop kitchen-sink
```

### SE-03: Bot name edge cases

**Goal**: Test name validation boundaries.

```bash
mecha bot spawn "a" .              # EXPECT: Success (min length)
mecha bot spawn "a-b-c-d" .       # EXPECT: Success (hyphens)
mecha bot spawn "UPPER" .         # EXPECT: Error or lowercase conversion
mecha bot spawn "with spaces" .   # EXPECT: Error
mecha bot spawn "" .              # EXPECT: Error
```

### SE-04: Stop nonexistent bot

**Goal**: Clean error handling.

```bash
mecha bot stop nonexistent-bot  # EXPECT: Clean error, not crash
mecha bot start nonexistent-bot  # EXPECT: Clean error
```

### SE-05: Double spawn same name

**Goal**: Verify BotAlreadyExistsError works.

```bash
mecha bot spawn dupe-test .
mecha bot spawn dupe-test .  # EXPECT: Error "Bot already exists"
mecha bot stop dupe-test
```

---

## Test Execution Order

1. **Section A** (FV-01 to FV-05) — Verify fixes first
2. **Section B** (OB-01 to OB-06) — Deep-dive open bugs
3. **Section C** (UT-01 to UT-08) — Cover undertested areas
4. **Section D** (SE-01 to SE-05) — Stress and edge cases

**Total**: 24 tests

## Priority Matrix

| Priority | Tests | Rationale |
|----------|-------|-----------|
| P0 (must) | FV-01, FV-02, OB-03, OB-04, UT-03, SE-05 | Fix verification + crash recovery + basic correctness |
| P1 (should) | FV-03, FV-04, FV-05, OB-01, OB-02, OB-05, UT-05, SE-01 | Regression + open bugs + budget |
| P2 (nice) | OB-06, UT-01, UT-02, UT-04, UT-06, UT-07, UT-08, SE-02, SE-03, SE-04 | New coverage + edge cases |

## Success Criteria

- **All Section A tests PASS** (no regressions)
- **At least one R7-001/R7-002 root cause identified** (actionable fix path)
- **No new CRITICAL/HIGH findings**
- **Section D edge cases handled cleanly** (errors, not crashes)
