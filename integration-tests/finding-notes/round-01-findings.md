# Round 01 — Bot Lifecycle Findings

**Version**: 4.1.1
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

27/29 tests passed. 1 partial, 1 test doc error (fixed).

## Findings

### Finding 1 — Meter proxy stale state after daemon restart

- **Severity**: Medium
- **Observed**: Every `bot start`/`bot restart` logs warnings:
  ```
  Meter proxy PID alive but port unreachable, skipping metering
  Meter proxy is not running (stale proxy.json), skipping metering
  ```
- **Cause**: `mecha stop --force` killed the daemon but left `proxy.json` with a stale PID. On restart, the meter proxy PID check finds the process alive (it's the daemon, not the proxy) but the meter port 7600 isn't bound.
- **Impact**: Bots spawn with `--meter off` behavior even when metering is expected. Spawn with default meter mode fails with "Metering proxy required but not running."
- **Workaround**: Run `mecha meter stop && mecha meter start` after daemon restart.
- **Fix**: pending — need to clean up proxy.json on daemon stop, or re-start meter proxy as part of `mecha start -d`.

### Finding 2 — `bot find` takes no arguments

- **Severity**: Low (test doc error)
- **Observed**: `mecha bot find test-bot` → "error: too many arguments for 'find'"
- **Cause**: `bot find` is a no-argument discovery command, not a name lookup.
- **Fix**: Updated test doc to match actual command signature.

### Finding 3 — `--sandbox off` doesn't persist sandboxMode in config

- **Severity**: Low
- **Observed**: `mecha bot spawn sandbox-off /tmp/test-project --sandbox off` succeeds but `config.json` has no `sandboxMode` field.
- **Impact**: On restart, bot may use the default sandbox mode ("auto") instead of "off".
- **Fix**: pending investigation — may be by design (sandbox mode applied at spawn time only).
