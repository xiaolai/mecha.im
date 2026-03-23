# 030 - WebSocket Terminal Endpoint Missing

**Test:** 9.9 - WebSocket terminal
**Machine:** spark01 (100.100.1.5)
**Severity:** P1

## Observed

`GET /bots/coder/terminal` with WebSocket upgrade headers returns HTTP 404.

```
curl -H "Upgrade: websocket" ... http://100.100.1.5:7660/bots/coder/terminal
→ 404
```

## Expected

A WebSocket endpoint should exist at `/bots/<name>/terminal` to provide an interactive xterm.js-compatible session.

## Impact

Dashboard terminal feature cannot work. Users have no way to interact with a bot through the web UI in real-time.

## Notes

No `wscat` is installed on the test machines, but the HTTP 404 confirms the endpoint does not exist server-side regardless of client tooling.
