# 10 - Sandbox

Tests for platform-specific sandbox isolation.

## Prerequisites

- Mecha daemon running
- macOS: sandbox-exec available (default on macOS)
- Linux: user namespaces enabled (`sysctl user.max_user_namespaces`)

## Tests

### Sandbox Modes

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 10.1 | Spawn with auto sandbox | `mecha bot spawn sandboxed ~/project --sandbox auto` | Sandbox applied if platform supports it | P0 | |
| 10.2 | Spawn with require sandbox | `mecha bot spawn strict ~/project --sandbox require` | Sandbox mandatory, fails if unavailable | P0 | |
| 10.3 | Spawn with sandbox off | `mecha bot spawn unsandboxed ~/project --sandbox off` | No sandbox applied | P1 | |
| 10.4 | Check sandbox info | `mecha bot status sandboxed` or `curl .../bots/sandboxed/sandbox` | Shows sandbox mode and profile | P1 | |

### macOS Sandbox (sandbox-exec)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 10.5 | File read restriction | Bot tries to read outside workspace | sandbox-exec blocks access | P0 | |
| 10.6 | Network allowed | Bot makes HTTP request (API call) | Network access allowed | P0 | |
| 10.7 | Profile generated | Check `~/.mecha/<bot>/.claude/sandbox-profile.sbpl` | Valid sbpl file exists | P1 | |

### Linux Sandbox (namespace)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 10.8 | Namespace isolation | Bot tries to access host filesystem | Blocked by namespace | P0 | |
| 10.9 | Unsupported platform fallback | On Linux without user namespaces | Logs warning, runs without sandbox | P1 | |

### Sandbox + Permissions

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 10.10 | dangerouslySkipPermissions requires sandbox | `mecha bot spawn dsp ~/project --dangerously-skip-permissions --sandbox off` | Error: requires sandbox=require | P0 | |

## Platform Test Matrix

| Test | macOS (mac-mini) | Linux x64 (linode02) | Linux arm64 (spark01) |
|------|-----------------|---------------------|----------------------|
| Auto sandbox | | | |
| Require sandbox | | | |
| File isolation | | | |
| Network allowed | | | |
