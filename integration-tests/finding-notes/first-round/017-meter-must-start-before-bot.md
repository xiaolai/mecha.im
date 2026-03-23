# 012 - Meter Proxy Must Start Before Bots (Ordering Dependency)

## Category
07 - Metering & Budgets

## Affected Tests
7.5, 7.6, 7.7

## Severity
Medium - Easy to misconfigure

## Description

The meter proxy URL is injected into the bot's environment at spawn time via `proxy.json`. If the meter is not running when a bot is started, the bot communicates directly with the Anthropic API, bypassing the meter entirely. No cost events are recorded and no budget enforcement occurs.

The `mecha start` daemon handles this correctly (starts meter before bots), but manual `mecha meter start` + `mecha bot start` requires the correct ordering.

## Steps to Reproduce

1. Start bot without meter: `mecha bot start coder`
2. Start meter: `mecha meter start`
3. Chat with bot - meter records nothing (bot bypasses proxy)
4. Must: stop bot, verify meter is running, start bot again

## Evidence

When bot starts without `proxy.json`:
```
$ cat ~/mecha-camp/meter/proxy.json
cat: No such file or directory
$ mecha bot start coder     # bot goes direct to Anthropic
$ mecha meter start          # creates proxy.json, but too late
```

## Expected Behavior

Either:
- Bot should check for proxy.json at request time (not just at startup)
- `mecha bot start` should warn if meter is not running
- Documentation should make ordering requirement explicit

## Impact

- Silent misconfiguration leads to unbilled API usage
- Users may not realize their cost tracking is inactive
