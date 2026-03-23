# 02 - Chat & Query

Tests for SDK-backed chat via CLI, HTTP API, and inter-bot routing.

## Prerequisites

- Bot running: `mecha bot spawn coder ~/project --expose query`
- Valid ANTHROPIC_API_KEY in environment

## Tests

### CLI Chat

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 2.1 | Basic chat | `mecha bot chat coder "What is 2+2?"` | Response printed to stdout, session ID shown | P0 | |
| 2.2 | Chat with session resume | `mecha bot chat coder "Remember: my name is Bob" -s <session-id>` then `mecha bot chat coder "What is my name?" -s <session-id>` | Second response mentions "Bob" | P0 | |
| 2.3 | Chat with nonexistent bot | `mecha bot chat ghost "Hello"` | Error: bot not found | P0 | |
| 2.4 | Chat with stopped bot | Stop bot, `mecha bot chat coder "Hello"` | Error: bot not running | P0 | |

### HTTP API Chat

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 2.5 | POST /api/chat | `curl -X POST http://127.0.0.1:<port>/api/chat -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"message":"Hello"}'` | JSON: `{ response, sessionId, durationMs, costUsd }` | P0 | |
| 2.6 | Chat with sessionId | Same as 2.5 with `"sessionId": "<id>"` | Same sessionId in response | P0 | |
| 2.7 | Missing message | `curl ... -d '{}'` | 400: `{ error: "message is required" }` | P0 | |
| 2.8 | Message too large | Send >64KB message | 413: `{ error: "message too large" }` | P1 | |
| 2.9 | Invalid sessionId type | `curl ... -d '{"message":"hi","sessionId":123}'` | 400: `{ error: "sessionId must be a string" }` | P1 | |
| 2.10 | No auth header | `curl ... (no Authorization)` | 401 | P0 | |
| 2.11 | Wrong auth token | `curl ... -H "Authorization: Bearer wrong"` | 401 | P0 | |

### Inter-Bot Query (via Agent)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 2.12 | Query via agent API | Spawn alice (expose query), spawn bob. `curl -X POST http://127.0.0.1:7660/bots/alice/query -H "Cookie: mecha-session=<token>" -H "X-Mecha-Source: bob@local" -H "Content-Type: application/json" -d '{"message":"Hello"}'` | Response from alice | P0 | |
| 2.13 | Query without ACL | No ACL rule granting bob→alice query. Same curl | 403 Forbidden | P0 | |
| 2.14 | Query with ACL grant | `mecha acl grant bob query alice`, then query | Response from alice | P0 | |
| 2.15 | Query nonexistent bot | Query to `ghost` | 404 | P0 | |
| 2.16 | Query stopped bot | Stop alice, query | Error (502 or 404) | P1 | |

## Verification

```bash
# Check bot token for direct API calls
cat ~/.mecha/<bot>/config.json | jq .token

# Check session was created
mecha bot sessions ls <bot>

# Check ACL state
mecha acl show
```
