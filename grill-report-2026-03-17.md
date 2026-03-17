---
plugin: grill
version: 1.2.0
date: 2026-03-17
target: /Users/joker/github/xiaolai/myprojects/mecha.im
style: Select All (1-5)
addons: all
agents: [recon, architecture, error-handling, security, testing, edge-cases]
---

# Grill Report: Mecha CLI (feat/cli-first-or-preferred branch)

## Scope

13 source files, 1803 lines changed. CLI tool managing AI agent bots in Docker containers. TypeScript ESM, Commander.js v14, dockerode v4, picocolors, ora.

---

## Architecture Review

### [HIGH] Hardcoded version `0.1.0` in Commander and MCP server
`src/cli.ts:38` has `.version("0.1.0")` and `src/mcp-proxy.ts:89` has `version: "0.1.0"`. Package.json is `0.3.3`. The `mecha --version` flag returns stale data. **Evidence:** `grep -n 'version.*0.1.0' src/cli.ts src/mcp-proxy.ts` shows both. **Effort:** 5 min.

### [HIGH] Shell completion command lists hardcoded and already diverged
`src/commands/completion.ts` — bash includes `push-dashboard`, zsh omits it. Zsh omits `mcp`. Fish omits `mcp`. Bot-name completions omit `costs`, `schedule`, `webhooks`. **Evidence:** Compare lines 8, 32-55, 79 against actual `program.commands` in cli.ts. **Effort:** 30 min to generate from Commander definition.

### [MEDIUM] God file cli.ts at 507 lines — 16 inline commands
Commands like `spawn` (35 lines), `ls` (45 lines), `query` (60 lines), `ssh-key` (22 lines) should be extracted to `commands/` modules. Only 8 of 24 commands use the `registerXxxCommand` pattern. **Effort:** 2 hours.

### [MEDIUM] Confusing `cli-utils.ts` vs `cli.utils.ts` naming
Both serve the same CLI, imported side-by-side. Naming difference (hyphen vs dot) is arbitrary. **Effort:** 30 min to merge.

### [MEDIUM] Two data access paths undocumented
`costs.ts` and `config.ts` read filesystem directly. `sessions.ts`, `schedule.ts`, `webhooks.ts` use bot HTTP API. No documentation or type markers distinguish host-side vs container-side commands. **Effort:** 15 min to document.

---

## Error Handling

### [HIGH] `schedule rm/pause/resume/run` and `webhooks add/rm` never check HTTP response status
`src/commands/schedule.ts:66-98` and `src/commands/webhooks.ts:44-58` use `botApi()` which returns raw Response. Unlike `botApiJson()`, it does NOT check `resp.ok`. Users told "Schedule X removed" when the API may have returned 404 or 500. **Effort:** 15 min.

### [HIGH] `botApi`/`botApiJson` throw plain Error instead of MechaError
`src/commands/bot-api.ts:19,40-41` — errors bypass structured error display (no color, no hints). **Effort:** 15 min.

### [MEDIUM] `process.exit(1)` vs `throw MechaError` inconsistency
~20 locations in cli.ts and command modules use `console.error + process.exit(1)` instead of throwing `MechaError`. Error output varies unpredictably. **Effort:** 1 hour.

### [MEDIUM] Corrupt `credentials.yaml` silently returns empty credentials
`src/auth.ts:47-49` — users silently lose all auth with no visible error. Structured logger warning is invisible during normal CLI usage. **Effort:** 15 min.

### [MEDIUM] Corrupt `registry.json` silently returns empty registry
`src/store.ts:102-108` — all bots "disappear" with no user-visible error. **Effort:** 15 min.

---

## Security

### [HIGH] TOTP rate limiting bypassable via X-Forwarded-For spoofing
`src/dashboard-server.ts:53` and `src/dashboard-server-utils.ts:80` — rate limiter and loopback check both trust client-controlled `X-Forwarded-For` header. Attacker can rotate IPs to bypass rate limit, or spoof `127.0.0.1` to get auto-session when TOTP is disabled. **Effort:** 30 min.

### [HIGH] Dashboard spawn `dir` parameter allows writing to arbitrary home subdirectory
`src/dashboard-server.ts:153` — `dir` accepts any path under `$HOME`. Can create state dirs and write credentials to unintended locations. **Effort:** 15 min to add allowlist.

### [MEDIUM] Bot-level dashboard session cookie missing Secure flag
`agent/routes/dashboard.ts:44` — HMAC session cookie sent over plain HTTP if bot port is exposed. **Effort:** 5 min.

### [MEDIUM] TOTP enable returns raw secret in response body
`src/dashboard-server.ts:291-298` — extractable from browser DevTools, proxy logs. **Effort:** Architectural (unavoidable for TOTP setup UX).

### [LOW] `mecha auth add <name> <key>` exposes API key in process list
`src/commands/auth.ts:22` — visible via `ps aux` on multi-user systems. **Effort:** 30 min to add stdin/file reading option.

---

## Testing

### [CRITICAL] 9 new command modules have zero unit tests
`src/commands/{bot-api,schedule,webhooks,sessions,costs,config,auth,completion,push-dashboard}.ts` — 750+ lines of new code with no tests. **Effort:** 2-3 days.

### [HIGH] No CI tests run at all
3 GitHub Actions workflows, none run `npm test` or `npm run build`. PRs can be merged without any automated verification. **Effort:** 1 hour.

### [HIGH] `formatUptime()`, `readCostsToday()`, `printTable()` are pure functions with no tests
Perfect unit test candidates, completely untested. **Effort:** 1 hour.

### [HIGH] Config `--set` value coercion has fragile regex with no tests
`src/commands/config.ts:45-49` — edge cases like `"0"`, `"01"`, `"1.0"`, empty string untested. **Effort:** 30 min.

### [MEDIUM] T19 tests a duplicated copy of functions instead of real exports
`test/t19-cli-query.ts:37-112` — duplicates `escapeAttr`/`collectAttachments` despite them being exported. Tests can pass while real code is broken. **Effort:** 15 min.

---

## Edge Case Risk Matrix

| Risk | Scenario | Component | File |
|------|----------|-----------|------|
| **CRITICAL** | `getOrCreateFleetInternalSecret` races on concurrent spawn, breaks fleet auth | store | `src/store.ts:167-185` |
| **CRITICAL** | `auth swap` non-atomic stop+remove+spawn leaves bot with wrong auth | auth | `src/commands/auth.ts:82-110` |
| **HIGH** | `runInContainer` leaves terminal in raw mode when container is killed | docker | `src/docker.ts:389-399` |
| **HIGH** | `config --set` read-modify-write without locking loses concurrent edits | config | `src/commands/config.ts:22-53` |
| **HIGH** | `stop --all` / `restart --all` exit 0 on partial failure | cli | `src/cli.ts:166-176` |
| **MED** | `costs.json` concurrent read during bot write returns zero costs | costs | `src/cli-utils.ts:18-31` |
| **MED** | `cmd.parent.parent.args[0]` fragile coupling to Commander.js internals | schedule | `src/commands/schedule.ts:53` |
| **MED** | `formatUptime` shows container creation time, not actual start time | ls | `src/docker.ts:339` |
| **LOW** | Completion scripts hardcoded and already out of sync | completion | `src/commands/completion.ts` |
| **LOW** | `readPromptSSE` drops final buffer if no trailing newline | query | `src/cli.utils.ts:98-135` |

---

## Add-On Pressure Tests

### Scale Stress
With 100x bots and a doubled team: `mecha ls` reads every bot's `costs.json` sequentially — O(n) filesystem reads per invocation. `stop --all` and `restart --all` iterate sequentially — a 100-bot stop takes minutes. `resolveHostBotBaseUrl` probes endpoints with 2s timeouts per candidate — schedule/webhook commands on unreachable bots block for 8+ seconds. The filesystem-based registry lock spin-waits under contention from multiple CLI processes.

### Hidden Costs
1. **Debugging cost:** Two error paths (process.exit vs MechaError) mean inconsistent output — support tickets about "different error formats."
2. **Onboarding cost:** `cli-utils.ts` vs `cli.utils.ts` naming confusion wastes new contributor time.
3. **Velocity cost:** Shell completions are manual — every new command requires updating 3 hardcoded strings.
4. **Operational cost:** No CI tests means regressions ship to users.
5. **Trust cost:** Silent credential/registry corruption means users can't trust `mecha ls` output.

### Principle Violations
- **SRP:** `cli.ts` is both command registry and 16 command implementations.
- **Dependency Inversion:** `costs.ts` and `config.ts` depend on filesystem paths directly, not an abstraction.
- **Least Privilege:** Dashboard `dir` parameter allows writing to any home subdirectory.
- **Fail-Fast:** `tryAcquire()` in store.ts proceeds without lock instead of failing.

### Compact & Optimize
- Merge `cli-utils.ts` and `cli.utils.ts` into one file.
- Extract 16 inline commands from `cli.ts` into `commands/` modules.
- `ssh-key` command re-imports already-imported modules via dynamic `import()` — remove redundant imports.
- Generate shell completions from Commander.js program definition instead of hardcoding.

---

## Executive Summary

### One-Paragraph Verdict
The CLI branch delivers strong functional coverage — 24 commands with full dashboard parity, colors, spinners, and completions. The architecture is fundamentally sound (clean dependency direction, consistent command pattern, good error hierarchy). However, there are **two critical race conditions** (`getOrCreateFleetInternalSecret` and `auth swap`) that can break fleet authentication silently, **zero tests for 750+ lines of new code**, **no CI pipeline**, and several security findings around `X-Forwarded-For` spoofing. The code is shippable for a solo developer but not safe for production fleet use without addressing the critical items.

### Top 3 Actions
1. **Fix `getOrCreateFleetInternalSecret` and `writeSettingsSafe` to use `acquire()` instead of `tryAcquire()`** — The proceed-without-lock pattern on a security-critical path is the highest-risk bug in the codebase. 15 min fix.
2. **Add a CI workflow that runs `npm run build && npm test`** — Zero automated testing means every push is a gamble. 30 min fix, prevents all future regressions.
3. **Check `resp.ok` in all `botApi()` callers** (schedule, webhooks) — Users are told operations succeeded when they may have failed. 15 min fix.

### Confidence Level
- `getOrCreateFleetInternalSecret` race: **High** — code path is unambiguous, `tryAcquire` returns null under contention.
- CI gap: **High** — verified no test step exists in any workflow.
- `botApi` response checking: **High** — `botApi` returns raw Response, callers don't check `resp.ok`.
- X-Forwarded-For spoofing: **Medium** — exploitable only when dashboard is network-accessible.
- Terminal raw mode leak: **Medium** — depends on Docker container kill behavior (needs manual testing to confirm).

### Paranoid Verdict
**The single scariest thing: `getOrCreateFleetInternalSecret()` at `src/store.ts:167-185`.** On the very first fleet setup, if two bots are spawned concurrently, each generates a different fleet internal secret. The last writer wins, and the first bot's container runs with a secret that no longer matches. All fleet-internal auth fails silently — no error at generation time, mysterious 401s later. `tryAcquire()` proceeding without the lock is the exact opposite of what a mutex should do.

---

## Fixing Plan

### Phase 1: Critical fixes (do immediately)

1. **`getOrCreateFleetInternalSecret` race condition**
   - **Finding:** `tryAcquire()` proceeds without lock when contention exists
   - **Fix:** Replace `tryAcquire()` with `await settingsMutex.acquire()` in both `getOrCreateFleetInternalSecret` and `writeSettingsSafe`. Make both functions `async`.
   - **Effort:** 30 min (need to update all callers to await)
   - **Files:** `src/store.ts`

2. **`auth swap` non-atomic lifecycle**
   - **Finding:** stop+remove+spawn as separate locked operations allows race
   - **Fix:** Wrap the entire swap sequence in a single `withBotLock(name, async () => { ... })` call
   - **Effort:** 30 min
   - **Files:** `src/commands/auth.ts`

### Phase 2: High-priority fixes (this sprint)

3. **Schedule/webhook commands don't check HTTP response**
   - **Finding:** `botApi()` callers assume success
   - **Fix:** Add `const resp = await botApi(...); if (!resp.ok) throw new Error(...)` or switch to `botApiJson()` for all mutating calls
   - **Effort:** 15 min
   - **Files:** `src/commands/schedule.ts`, `src/commands/webhooks.ts`

4. **`botApi`/`botApiJson` throw plain Error**
   - **Finding:** Errors bypass MechaError structured display
   - **Fix:** Create `BotApiError` via `defError` and throw it instead
   - **Effort:** 15 min
   - **Files:** `src/commands/bot-api.ts`, `shared/errors.ts`

5. **Add CI test workflow**
   - **Finding:** No tests run in CI
   - **Fix:** Create `.github/workflows/ci.yml` with `npm run build && npm test` on PR and push to main
   - **Effort:** 30 min
   - **Files:** `.github/workflows/ci.yml`

6. **Fix hardcoded version 0.1.0**
   - **Finding:** `cli.ts:38` and `mcp-proxy.ts:89` show stale version
   - **Fix:** Read version from package.json at startup
   - **Effort:** 10 min
   - **Files:** `src/cli.ts`, `src/mcp-proxy.ts`

7. **`runInContainer` terminal raw mode leak**
   - **Finding:** No error handler or SIGINT handler; terminal left in raw mode on container kill
   - **Fix:** Add `stream.on("error")`, `process.on("SIGINT")`, and `try/finally` around raw mode
   - **Effort:** 20 min
   - **Files:** `src/docker.ts`

8. **`stop --all` / `restart --all` exit code on partial failure**
   - **Finding:** Always exits 0 even when some bots fail
   - **Fix:** Track failure count, exit 1 if any failed
   - **Effort:** 10 min
   - **Files:** `src/cli.ts`

9. **X-Forwarded-For spoofing in rate limiter and loopback check**
   - **Finding:** Client-controlled header used for security decisions
   - **Fix:** Use Hono's `c.req.raw` socket address or require a trusted proxy config
   - **Effort:** 30 min
   - **Files:** `src/dashboard-server.ts`, `src/dashboard-server-utils.ts`

### Phase 3: Medium-priority improvements (next sprint)

10. **Replace `process.exit(1)` with MechaError throws** — 20 locations across cli.ts and command modules. **Effort:** 1 hour. **Files:** `src/cli.ts`, `src/commands/*.ts`

11. **Merge `cli-utils.ts` and `cli.utils.ts`** — Eliminate confusing naming. **Effort:** 30 min. **Files:** `src/cli-utils.ts`, `src/cli.utils.ts`

12. **Config --set: use atomic write + lock** — Prevent concurrent edit race. **Effort:** 20 min. **Files:** `src/commands/config.ts`

13. **Generate shell completions from Commander definition** — Eliminate hardcoded lists. **Effort:** 1 hour. **Files:** `src/commands/completion.ts`

14. **Fix `formatUptime` to use actual start time** — Inspect container for `State.StartedAt` instead of `Created`. **Effort:** 20 min. **Files:** `src/docker.ts`

15. **Add Secure flag to bot-level dashboard cookie** — **Effort:** 5 min. **Files:** `agent/routes/dashboard.ts`

16. **Add tests for new command modules** — At minimum: `bot-api.ts`, `costs.ts`, `config.ts` (value coercion). **Effort:** 2 days. **Files:** `test/`

### Phase 4: Low-priority cleanup (when touching these files)

17. **`src/cli.ts`** — Extract 16 inline commands to `commands/` modules; remove redundant dynamic imports in ssh-key
18. **`src/commands/schedule.ts`** — Validate schedule IDs before sending to API; replace `cmd.parent.args` with passthrough options
19. **`src/commands/completion.ts`** — Add `costs`, `schedule`, `webhooks` to bot-name completion lists
20. **`src/cli.utils.ts`** — Handle final SSE buffer in `readPromptSSE`
21. **`src/commands/auth.ts`** — Add stdin reading option for `auth add` key input
22. **`test/t19-cli-query.ts`** — Import real functions instead of duplicating

### Dependency Graph
- Fix 4 (BotApiError) should precede Fix 3 (schedule/webhook response checking)
- Fix 10 (process.exit → MechaError) depends on Fix 4
- Fix 11 (merge utils) should precede Fix 16 (add tests)
- Fix 13 (generated completions) depends on Fix 17 (extracting inline commands to get clean program definition)

### Estimated Total Effort
- Phase 1: 1 hour
- Phase 2: 2.5 hours
- Phase 3: 2 days
- Phase 4: 1 day (opportunistic)
- **Total**: ~3.5 days
