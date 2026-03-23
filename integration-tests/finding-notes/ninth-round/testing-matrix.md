# Round 9 Testing Matrix — v0.2.17 (tsup/npm migration)

**Target version**: v0.2.17 (first npm-distributed release)
**Focus areas**: Bun→npm distribution migration, runtime resolution, SPA serving, sandbox with Node runtime, cross-platform installation, regression sweep

## What Changed (v0.2.16 → v0.2.17)

The entire distribution model changed:

| Aspect | Before (Bun) | After (npm) |
|--------|-------------|-------------|
| Build tool | `tsc -b` | `tsup` (esbuild) |
| Distribution | Single compiled binary | `npm install -g mecha.im` |
| Runtime spawn | Binary re-invokes itself with `__runtime` | `node runtime.js` via require.resolve |
| SPA delivery | Embedded base64 archive → extracted to `~/.mecha/.spa-cache/` | Copied to `dist/spa/` in npm package |
| Package name | `@mecha/cli` (unpublished) | `mecha.im` (npmjs.com) |
| Install (macOS) | `brew install xiaolai/tap/mecha` | `npm install -g mecha.im` |
| Install (Linux) | `curl \| tar` binary download | `npm install -g mecha.im` |
| Prerequisite | None (standalone binary) | Node.js >= 20.0.0 |

## Open Bugs From Previous Rounds

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| R7-002 | MEDIUM | UPSTREAM | systemPrompt not applied — Claude CLI SDK mode ignores init message |
| R7-003 | LOW | OPEN | SSE lifecycle events not delivered |
| R8-001 | HIGH | FIXED (v0.2.15) | Sandbox EPERM: /dev/null write permission in SBPL |

---

## Section A: npm Package Integrity (6 tests)

Core question: does `npm install -g mecha.im` produce a working CLI?

### NPM-01: Publish build produces valid tarball

**Goal**: `pnpm build:publish` completes without errors and all artifacts present.

```bash
cd /path/to/mecha.im-v2
pnpm build:publish
# EXPECT: Script completes, prints:
#   OK: dist/main.js
#   OK: dist/runtime.js
#   OK: dist/pty-bridge-script.js
#   OK: dist/spa/index.html
#   Smoke test passed: mecha --version works
```

### NPM-02: Tarball installs cleanly (macOS arm64)

**Goal**: Fresh npm install on macOS works.

```bash
# On mac-mini-home
npm install -g mecha.im
which mecha        # EXPECT: /usr/local/bin/mecha or ~/.npm/bin/mecha
mecha --version    # EXPECT: 0.2.17
mecha --help       # EXPECT: Full help output with all subcommands
```

### NPM-03: Tarball installs cleanly (Linux x64)

**Goal**: Fresh npm install on Linux x64 works.

```bash
# On linode02
npm install -g mecha.im
which mecha        # EXPECT: path in npm global bin
mecha --version    # EXPECT: 0.2.17
mecha --help       # EXPECT: Full help output
```

### NPM-04: Tarball installs cleanly (Linux arm64)

**Goal**: Fresh npm install on Linux arm64 works.

```bash
# On spark01
npm install -g mecha.im
which mecha        # EXPECT: path in npm global bin
mecha --version    # EXPECT: 0.2.17
mecha --help       # EXPECT: Full help output
```

### NPM-05: npx works without global install

**Goal**: `npx mecha.im` runs without prior install.

```bash
# In a clean environment (or after npm uninstall -g mecha.im)
npx mecha.im --version    # EXPECT: Downloads, runs, prints version
npx mecha.im --help       # EXPECT: Full help output
```

### NPM-06: npm update preserves state

**Goal**: Upgrading preserves `~/.mecha/` state.

```bash
# Pre-condition: mecha running with bots
mecha bot ls > /tmp/before-upgrade.txt
npm update -g mecha.im
mecha --version            # EXPECT: New version
mecha bot ls > /tmp/after-upgrade.txt
diff /tmp/before-upgrade.txt /tmp/after-upgrade.txt
# EXPECT: Bot list identical (state preserved in ~/.mecha/)
```

---

## Section B: Runtime Resolution (4 tests)

Core question: does the CLI correctly find and spawn the runtime server?

### RT-01: Bot spawn works (npm-installed)

**Goal**: Spawning a bot uses the bundled `runtime.js`, not a binary.

```bash
# After npm install -g mecha.im
mecha bot spawn rt-test .
mecha bot ls               # EXPECT: rt-test running on port 7700-7799
# Verify it's a Node process, not a binary:
ps aux | grep rt-test | grep -v grep
# EXPECT: "node" in the command, NOT a standalone binary path
mecha bot stop rt-test
```

### RT-02: Bot spawn works (monorepo dev)

**Goal**: In monorepo dev, runtime resolves via pnpm workspace symlink.

```bash
cd /path/to/mecha.im-v2
pnpm build
node packages/cli/dist/main.js bot spawn dev-test .
node packages/cli/dist/main.js bot ls   # EXPECT: dev-test running
node packages/cli/dist/main.js bot stop dev-test
```

### RT-03: Runtime healthcheck responds

**Goal**: Spawned runtime server responds to health check.

```bash
mecha bot spawn health-test .
PORT=$(mecha bot ls --json | jq -r '.[] | select(.name=="health-test") | .port')
TOKEN=$(jq -r .token ~/.mecha/health-test/config.json)
curl -s http://localhost:$PORT/healthz -H "Authorization: Bearer $TOKEN"
# EXPECT: 200 {"status":"ok",...}
mecha bot stop health-test
```

### RT-04: PTY bridge script accessible

**Goal**: Terminal functionality works (pty-bridge-script.js resolves correctly).

```bash
mecha bot spawn pty-test .
PORT=$(mecha bot ls --json | jq -r '.[] | select(.name=="pty-test") | .port')
TOKEN=$(jq -r .token ~/.mecha/pty-test/config.json)
# Verify terminal WebSocket endpoint exists:
curl -s http://localhost:$PORT/api/terminal -H "Authorization: Bearer $TOKEN" -H "Upgrade: websocket" -o /dev/null -w "%{http_code}"
# EXPECT: 400 or 426 (Upgrade Required) — NOT 404 or 500
mecha bot stop pty-test
```

---

## Section C: SPA Dashboard (4 tests)

Core question: does the dashboard serve correctly from `dist/spa/`?

### SPA-01: Dashboard accessible via `mecha start`

**Goal**: `mecha start` serves the SPA dashboard.

```bash
mecha start
# Open browser to http://localhost:7660
# EXPECT: Login page loads (SPA serves index.html)
# Check via curl:
curl -s http://localhost:7660/ -o /dev/null -w "%{http_code}"
# EXPECT: 200
```

### SPA-02: SPA static assets load

**Goal**: CSS, JS, and images all load from the SPA.

```bash
# Check that SPA bundle loads (not just index.html)
curl -s http://localhost:7660/ | grep -o 'src="/assets/[^"]*"'
# EXPECT: At least one JS bundle reference
# Fetch one asset:
ASSET=$(curl -s http://localhost:7660/ | grep -o '/assets/index-[^"]*\.js' | head -1)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:7660$ASSET"
# EXPECT: 200
```

### SPA-03: SPA serves on client-side routes

**Goal**: SPA fallback routing works (non-root paths serve index.html).

```bash
curl -s http://localhost:7660/bots -o /dev/null -w "%{http_code}"
# EXPECT: 200 (SPA handles client-side routing)
curl -s http://localhost:7660/settings -o /dev/null -w "%{http_code}"
# EXPECT: 200
```

### SPA-04: No stale SPA cache

**Goal**: After upgrade, dashboard serves the new SPA version (no `~/.mecha/.spa-cache/` interference).

```bash
# Old cache dir should not be used anymore
ls ~/.mecha/.spa-cache/ 2>/dev/null
# EXPECT: May exist from old binary installs, but mecha should NOT read from it
# Verify SPA is served from npm package, not cache:
mecha start
curl -s http://localhost:7660/ | head -5
# EXPECT: Fresh SPA content matching v0.2.17
```

---

## Section D: Sandbox with Node Runtime (4 tests)

Core question: does sandboxing work when wrapping `node + runtime.js` instead of a single binary?

### SB-01: macOS sandbox-exec with Node runtime

**Goal**: Bot spawns inside macOS sandbox with the new Node entrypoint.

```bash
# On mac-mini-home
mecha bot spawn sb-node . --sandbox auto
mecha bot ls               # EXPECT: sb-node running
cat ~/.mecha/sb-node/logs/stderr.log | grep -i "sandbox\|deny\|eperm"
# EXPECT: No sandbox errors
mecha bot stop sb-node
```

### SB-02: macOS sandbox — SDK chat works inside sandbox

**Goal**: Chat works inside sandbox (regression test for R8-001 /dev/null fix).

```bash
# On mac-mini-home
mecha bot spawn sb-chat . --sandbox auto
PORT=$(mecha bot ls --json | jq -r '.[] | select(.name=="sb-chat") | .port')
TOKEN=$(jq -r .token ~/.mecha/sb-chat/config.json)
curl -s -X POST http://localhost:$PORT/api/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"say hello"}'
# EXPECT: 200 with chat response (NOT EPERM)
mecha bot stop sb-chat
```

### SB-03: Linux namespace sandbox with Node runtime

**Goal**: Bot spawns inside Linux user namespace sandbox.

```bash
# On linode02 or spark01
mecha bot spawn sb-linux . --sandbox auto
mecha bot ls               # EXPECT: sb-linux running
cat ~/.mecha/sb-linux/logs/stderr.log | grep -i "sandbox\|deny\|eperm"
# EXPECT: No sandbox errors
mecha bot stop sb-linux
```

### SB-04: Sandbox profile includes Node binary

**Goal**: Sandbox profile allows execution of `node` binary.

```bash
mecha bot spawn sb-profile . --sandbox auto
# Check sandbox profile:
cat ~/.mecha/sb-profile/.claude/sandbox-profile.json 2>/dev/null | jq '.profile' || \
  cat ~/.mecha/sb-profile/sandbox-profile.json 2>/dev/null | jq '.profile'
# EXPECT: allowedProcesses includes node binary path
# EXPECT: readPaths includes node_modules and runtime entrypoint
mecha bot stop sb-profile
```

---

## Section E: Bot Lifecycle Regression (6 tests)

Core question: do basic bot operations work identically after the migration?

### BL-01: Spawn → status → stop → remove lifecycle

**Goal**: Full lifecycle works.

```bash
mecha bot spawn lifecycle-test .
mecha bot ls                     # EXPECT: running
mecha status                     # EXPECT: Shows lifecycle-test
mecha bot stop lifecycle-test
mecha bot ls                     # EXPECT: stopped
mecha bot remove lifecycle-test
mecha bot ls                     # EXPECT: Not listed
```

### BL-02: Restart preserves state

**Goal**: Bot restart works cleanly.

```bash
mecha bot spawn restart-test .
PORT_BEFORE=$(mecha bot ls --json | jq -r '.[] | select(.name=="restart-test") | .port')
mecha bot restart restart-test
PORT_AFTER=$(mecha bot ls --json | jq -r '.[] | select(.name=="restart-test") | .port')
echo "Before: $PORT_BEFORE, After: $PORT_AFTER"
# EXPECT: Same port, running state
mecha bot stop restart-test
```

### BL-03: Concurrent spawn (5 bots)

**Goal**: No port conflicts or race conditions.

```bash
for i in $(seq 1 5); do mecha bot spawn "par-$i" . & done; wait
mecha bot ls
# EXPECT: All 5 running with unique ports
mecha bot ls --json | jq '.[].port' | sort -u | wc -l
# EXPECT: 5
for i in $(seq 1 5); do mecha bot stop "par-$i"; done
```

### BL-04: Bot crash recovery

**Goal**: Crashed bot shows error state and can restart.

```bash
mecha bot spawn crash-test .
kill -9 $(mecha bot ls --json | jq -r '.[] | select(.name=="crash-test") | .pid')
sleep 2
mecha bot ls   # EXPECT: state = "error"
mecha bot start crash-test
mecha bot ls   # EXPECT: state = "running"
mecha bot stop crash-test
```

### BL-05: Daemon crash recovery

**Goal**: Daemon restart recovers bot state from disk.

```bash
mecha start --daemon
mecha bot spawn survive-test .
kill $(cat ~/.mecha/daemon.pid 2>/dev/null || pgrep -f "mecha.*daemon")
sleep 2
mecha start --daemon
mecha bot ls   # EXPECT: survive-test recovered
mecha bot stop survive-test
```

### BL-06: Chat works end-to-end

**Goal**: Bot can answer a query (runtime + SDK integration).

```bash
mecha bot spawn chat-test . --sandbox off
PORT=$(mecha bot ls --json | jq -r '.[] | select(.name=="chat-test") | .port')
TOKEN=$(jq -r .token ~/.mecha/chat-test/config.json)
curl -s -X POST http://localhost:$PORT/api/query \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"What is 2+2? Reply with just the number."}'
# EXPECT: 200 with response containing "4"
mecha bot stop chat-test
```

---

## Section F: Multi-Machine (4 tests)

Core question: does mesh networking work after the migration?

### MM-01: Cross-node registration

**Goal**: Nodes discover each other.

```bash
# On mac-mini-home (after npm install):
mecha node add linode02 100.100.1.9
mecha node ls   # EXPECT: linode02 listed
mecha status    # EXPECT: Shows mesh peer
```

### MM-02: Cross-node bot list

**Goal**: Remote bots appear in aggregated listing.

```bash
# On linode02: spawn a bot
mecha bot spawn remote-bot .
# On mac-mini-home:
mecha bot ls     # EXPECT: remote-bot@linode02 appears
```

### MM-03: Cross-node query

**Goal**: Query a bot on a remote node.

```bash
# On mac-mini-home, query bot on linode02:
mecha bot query remote-bot@linode02 "say hello"
# EXPECT: Response from remote bot (or clean error if chat not available)
```

### MM-04: Cross-platform consistency

**Goal**: Same CLI behavior on all 3 platforms.

```bash
# Run on each machine and compare:
mecha --version          # EXPECT: Same version on all
mecha --help | md5       # EXPECT: Same help output
mecha status --json      # EXPECT: Similar structure
```

---

## Section G: Previous Bug Regression (3 tests)

### REG-01: R8-001 sandbox /dev/null — no regression

**Goal**: macOS sandbox still allows /dev/null writes.

```bash
# On mac-mini-home:
mecha bot spawn sb-devnull . --sandbox auto
PORT=$(mecha bot ls --json | jq -r '.[] | select(.name=="sb-devnull") | .port')
TOKEN=$(jq -r .token ~/.mecha/sb-devnull/config.json)
curl -s -X POST http://localhost:$PORT/api/query \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"hello"}'
# EXPECT: 200 (NOT EPERM)
mecha bot stop sb-devnull
```

### REG-02: Concurrent port allocation — no regression

**Goal**: Atomic port allocation still works.

```bash
for i in $(seq 1 5); do mecha bot spawn "reg-$i" . & done; wait
mecha bot ls --json | jq '.[].port' | sort -u | wc -l
# EXPECT: 5 unique ports
for i in $(seq 1 5); do mecha bot stop "reg-$i"; done
```

### REG-03: cli.lock — no regression

**Goal**: Mutating CLI commands work while daemon running.

```bash
mecha start --daemon
mecha bot spawn lock-test .
mecha bot stop lock-test
# EXPECT: No "Another mecha CLI is already running" errors
```

---

## Test Execution Order

1. **Section A** (NPM-01 to NPM-06) — Package integrity first
2. **Section B** (RT-01 to RT-04) — Runtime resolution
3. **Section C** (SPA-01 to SPA-04) — Dashboard serving
4. **Section E** (BL-01 to BL-06) — Bot lifecycle regression
5. **Section D** (SB-01 to SB-04) — Sandbox with Node runtime
6. **Section G** (REG-01 to REG-03) — Previous bug regression
7. **Section F** (MM-01 to MM-04) — Multi-machine (last, requires all machines)

**Total**: 31 tests

## Priority Matrix

| Priority | Tests | Rationale |
|----------|-------|-----------|
| P0 (must) | NPM-01, NPM-02, NPM-03, RT-01, RT-03, BL-01, BL-06 | Package works, bots spawn, chat works |
| P1 (should) | NPM-04, NPM-05, NPM-06, RT-02, RT-04, SPA-01, SPA-02, BL-02, BL-03, BL-04, SB-01, SB-02, REG-01, REG-02 | Full platform coverage, dashboard, sandbox, regressions |
| P2 (nice) | SPA-03, SPA-04, BL-05, SB-03, SB-04, REG-03, MM-01 to MM-04 | Edge cases, multi-machine |

## Success Criteria

- **All P0 tests PASS** — package installs, bots spawn, chat works
- **All Section G regression tests PASS** — no regressions from previous fixes
- **SPA serves on at least one platform** — dashboard accessible
- **Sandbox works with Node runtime on macOS** — SB-01 or SB-02 PASS
- **No new CRITICAL findings**

## Pre-Test Checklist

Before starting Round 9 testing:

- [ ] Bump version to v0.2.17 in all package.json files
- [ ] Run `pnpm build:publish` successfully
- [ ] Publish to npm: `cd packages/cli && npm publish`
- [ ] Verify npm listing: `npm view mecha.im`
- [ ] Clean previous Bun binary installs on all machines:
  - macOS: `brew uninstall mecha` (if installed via Homebrew)
  - Linux: `sudo rm -f /usr/local/bin/mecha`
- [ ] Ensure Node.js >= 20 on all test machines:
  - `node --version` on linode02, spark01, mac-mini-home
- [ ] Update deploy-testing-notes.md with new installation procedures
