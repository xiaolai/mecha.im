# 03 - Sessions

Tests for session CRUD via CLI and HTTP API.

## Prerequisites

- Bot running with at least one chat session completed

## Tests

### CLI Session Management

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 3.1 | List sessions | `mecha bot sessions ls coder` | Lists all sessions with ID, title, timestamps | P0 | |
| 3.2 | Show session | `mecha bot sessions show coder <session-id>` | Displays transcript (user/assistant messages) | P0 | |
| 3.3 | List empty sessions | Spawn fresh bot, `mecha bot sessions ls fresh-bot` | Empty list (no error) | P1 | |

### HTTP API Sessions

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 3.4 | GET /api/sessions | `curl http://127.0.0.1:<port>/api/sessions -H "Authorization: Bearer <token>"` | JSON array of session metadata | P0 | |
| 3.5 | GET /api/sessions/:id | `curl http://127.0.0.1:<port>/api/sessions/<id> -H "..."` | Session with events/transcript | P0 | |
| 3.6 | GET nonexistent session | `curl .../api/sessions/nonexistent -H "..."` | 404 | P1 | |
| 3.7 | DELETE /api/sessions/:id | `curl -X DELETE .../api/sessions/<id> -H "..."` | 200, session removed | P1 | |
| 3.8 | DELETE nonexistent | `curl -X DELETE .../api/sessions/ghost -H "..."` | 404 | P1 | |

### Agent API Sessions

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 3.9 | GET /bots/:name/sessions | `curl http://127.0.0.1:7660/bots/coder/sessions` (with auth) | Session list matching runtime API | P1 | |
| 3.10 | GET /bots/:name/sessions/:id | `curl .../bots/coder/sessions/<id>` (with auth) | Full transcript | P1 | |
| 3.11 | DELETE /bots/:name/sessions/:id | `curl -X DELETE .../bots/coder/sessions/<id>` (with auth) | Session deleted | P1 | |

### Session Interop (SDK ↔ CLI)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 3.12 | Resume SDK session with CLI | Chat via HTTP API (creates session), then `claude --resume <session-id>` in bot workspace | CLI resumes same session context | P0 | |

## Session File Verification

```bash
# Session files live at:
ls ~/.mecha/<bot>/.claude/projects/<workspace-encoded>/

# Each session has:
# <session-id>.meta.json  — metadata (title, timestamps)
# <session-id>.jsonl      — SDK transcript
```
