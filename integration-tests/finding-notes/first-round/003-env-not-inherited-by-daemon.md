# Finding 003: Daemon doesn't inherit .env credentials

**Date**: 2026-03-10
**Severity**: MEDIUM
**Version**: v0.2.7
**Affected**: All platforms
**Category**: 01-bot-lifecycle, 06-auth-security

## Symptom

`mecha bot spawn` fails with:
```
No API credentials available for bot "test-bot".
Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the environment
```

Even though `~/.mecha/.env` contains `ANTHROPIC_API_KEY=sk-ant-...`

## Root Cause

When `mecha start --daemon` launches the daemon, it inherits the parent shell's environment. If the shell didn't `source ~/.mecha/.env`, the daemon has no API key. The `.env` file is NOT auto-loaded by the daemon process.

Bot spawning looks for credentials in this order:
1. Auth profile (`mecha auth add`)
2. Fallback: inherit from parent process env (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Fail if neither found

## Workaround

Either:
- `export ANTHROPIC_API_KEY=... && mecha start --daemon` (set env before daemon)
- `mecha auth add default --api-key --token sk-ant-...` (create auth profile)

## Recommendation

The daemon should auto-load `~/.mecha/.env` on startup, similar to how Docker Compose loads `.env` files. This would eliminate the manual export step.

## Status

- [x] Identified
- [ ] Fix needed in daemon startup
