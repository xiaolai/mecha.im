# 010 - Budget Enforcement Does Not Block Requests

## Category
07 - Metering & Budgets

## Affected Tests
7.13

## Severity
High - Budget limits have no effect

## Description

Setting a daily budget of $0.01 on a bot does not prevent the bot from processing further chat requests. The bot continues to respond normally with HTTP 200, even after multiple requests that should have exceeded the budget.

This is a consequence of finding 009 (zero cost tracking) - since all recorded costs are $0.00, the budget check always passes.

## Steps to Reproduce

1. Set low budget: `mecha budget set coder --daily 0.01`
2. Chat with bot (cost ~$0.007 per request)
3. Chat again - expected: 402 / budget exceeded error
4. Actual: 200 OK with normal response

## Evidence

```
$ mecha budget set coder --daily 0.01
Budget set for coder

$ curl -X POST http://127.0.0.1:7700/api/chat ... -d '{"message":"Say hi"}'
{"response":"Hi!","costUsd":0.0068859}   # HTTP 200 - not blocked
```

## Root Cause

Two issues compound:
1. Meter proxy records all costs as $0.00 (finding 009)
2. Even if costs were tracked correctly, the budget check happens at the proxy level. When the daemon isn't running or the meter didn't start before the bot, requests bypass the proxy entirely.

## Impact

- No budget enforcement - bots can consume unlimited API credits
- Setting budgets via CLI gives false sense of spending control
