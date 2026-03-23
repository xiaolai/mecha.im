# 025 - CLI Write Commands Blocked by Daemon Lock

**Severity:** High
**Tests affected:** 6.5, 6.7, 6.8, 6.9, 7.2, 7.3, 7.10, 7.12

## Problem

When the mecha daemon is running, all CLI commands that acquire a write lock are rejected with:

```
Another mecha CLI is already running (pid 779523)
```

Affected commands:
- `mecha auth add`, `mecha auth switch`, `mecha auth renew`, `mecha auth tag`
- `mecha meter start`, `mecha meter stop`
- `mecha budget set`, `mecha budget rm`

Read-only commands (`auth ls`, `auth test`, `meter status`, `cost`, `budget ls`, `node ls`, `node health`) work fine.

## Workaround

Some operations are accessible via the REST API (e.g., `POST /meter/start`, `POST /meter/stop`, `POST /budgets`, `DELETE /budgets`), but others have no API equivalent:
- `auth add`, `auth switch`, `auth renew`, `auth tag` have NO API endpoints
- All budget and meter operations DO have API equivalents

## Expected

CLI write commands should delegate to the running daemon via its API rather than trying to acquire the filesystem lock directly.

## Impact

Users cannot manage auth profiles or switch bot auth while the daemon is running, which is the normal operating state.
