# 005 - Session Resume Requires HOME Override

**Test:** 3.12 - Resume SDK session with CLI
**Severity:** Medium (expected behavior, but worth documenting)
**Machine:** spark01 (100.100.1.5)
**Date:** 2026-03-10

## Description

Resuming an SDK-created session with `claude --resume <session-id>` requires setting `HOME` to the bot's directory. Without this, the CLI looks in `~/.claude/projects/` (the user's home) instead of the bot's `.claude/projects/` directory, and reports "No conversation found."

## Steps to Reproduce

```bash
# FAILS - looks in user's ~/.claude
cd ~/mecha-camp/coder
claude --resume 8d69bf39-... -p "test"
# Error: No conversation found with session ID: ...

# WORKS - HOME set to bot dir
HOME=/home/joker/mecha-camp/coder claude --resume 8d69bf39-... -p "test"
# Successfully resumes and recalls previous context
```

## Impact

This is expected behavior (the bot filesystem mirrors real Claude Code layout with HOME as the bot root). The `mecha` CLI handles this internally when proxying commands. Direct `claude` CLI usage requires the HOME override.

## Verdict

PASS - Session interop works correctly when HOME is set properly. The bot's session files are at the expected path and the CLI successfully loads them.
