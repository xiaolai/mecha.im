# 21 - Task Protocol

Tests for inter-bot task delegation: create, execute, monitor, cancel, and result retrieval.

## Prerequisites

- Mecha daemon running: `mecha start -d`
- At least 2 bots spawned and running:
  ```bash
  mecha bot spawn coder ~/project --expose query
  mecha bot spawn analyst ~/project --expose query
  ```
- ACL configured for inter-bot query:
  ```bash
  mecha acl grant coder analyst query
  mecha acl grant analyst coder query
  ```
- Verify bots are healthy:
  ```bash
  mecha bot ls   # Both running, ports assigned
  ```

## Tests

### Task Creation

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.1 | Create task for local bot | `mecha task create analyst "Summarize the README"` | Returns task ID (`task-<16-hex>`), status: pending | P0 | |
| 21.2 | Create task — bot not found | `mecha task create nonexistent "hello"` | Error: Bot 'nonexistent' not found (404) | P0 | |
| 21.3 | Create task — invalid bot name | `mecha task create "../etc" "hello"` | Error: Invalid bot name (400) | P0 | |
| 21.4 | Create task — empty message | `mecha task create analyst ""` | Error: Invalid input (400) | P0 | |
| 21.5 | Create task — JSON output | `mecha --json task create analyst "Review code"` | Valid JSON with `id` and `status` fields | P1 | |

### Task Listing

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.6 | List all tasks | `mecha task list` | Table with ID, Target, Status, Message, Updated columns | P0 | |
| 21.7 | List by target | `mecha task list --target analyst` | Only tasks targeting analyst | P0 | |
| 21.8 | List by status | `mecha task list --status completed` | Only completed tasks | P1 | |
| 21.9 | List with invalid status | `mecha task list --status bogus` | Error: Invalid status (400) | P1 | |
| 21.10 | List — JSON output | `mecha --json task list` | Valid JSON array (empty `[]` if none) | P1 | |
| 21.11 | List — empty result | `mecha task list --target nobody` | "No tasks found" message | P1 | |

### Task Execution (End-to-End)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.12 | Task completes with result | `mecha task create analyst "What is 2+2?"` then poll with `mecha task show <id>` | Status transitions: pending → working → completed. Result field populated with bot response | P0 | |
| 21.13 | Task result has metadata | `mecha task show <id>` (after completion) | Shows: result text, sessionId, durationMs, costUsd | P0 | |
| 21.14 | Task failure reported | `mecha task create analyst "Use the nonexistent_tool tool"` | Status transitions to failed, error field populated | P1 | |

### Task Show

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.15 | Show completed task | `mecha task show <completed-id>` | Full detail: ID, target, status, message, result, session, duration, cost, timestamps | P0 | |
| 21.16 | Show pending task | `mecha task show <pending-id>` | Status: pending or working, no result yet | P0 | |
| 21.17 | Show nonexistent task | `mecha task show task-0000000000000000` | Error: Task not found (404) | P0 | |
| 21.18 | Show — JSON output | `mecha --json task show <id>` | Valid JSON task object | P1 | |

### Task Cancellation

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.19 | Cancel working task | Create a long task, then `mecha task cancel <id>` while working | Status: cancelled. Bot execution actually stops (check bot activity) | P0 | |
| 21.20 | Cancel pending task | Create task, immediately cancel | Status: cancelled | P0 | |
| 21.21 | Cancel completed task | `mecha task cancel <completed-id>` | Error: Cannot cancel task in 'completed' status (409) | P0 | |
| 21.22 | Cancel nonexistent task | `mecha task cancel task-0000000000000000` | Error: Task not found (404) | P0 | |

### Concurrency

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.23 | Multiple tasks same bot | Create 3 tasks for analyst in rapid succession | All 3 get unique IDs, execute (may serialize or parallel depending on SDK) | P0 | |
| 21.24 | Concurrency limit | Create 11+ tasks rapidly for one bot | First 10 accepted, 11th fails with "Concurrent task limit reached" | P1 | |
| 21.25 | Tasks on different bots | Create task for analyst and coder simultaneously | Both execute independently | P0 | |

### Startup Reconciliation

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.26 | Agent restart — stale tasks | Create a task, kill agent (`mecha stop`), restart (`mecha start -d`) | Previously "working"/"pending" tasks marked "failed" with "Agent restarted" error | P0 | |
| 21.27 | Cleanup of old tasks | Create a task, set its updatedAt to 8 days ago (manual edit of JSON), then `mecha task list` | Old completed/failed tasks cleaned up, working tasks preserved | P1 | |

### MCP Tools (Bot-to-Bot)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.28 | Bot creates task via MCP | Chat with coder: "Use the task_create tool to ask analyst to review your code" | Coder calls task_create, gets task ID back | P0 | |
| 21.29 | Bot checks task status | Chat with coder: "Use task_status to check on task <id>" | Returns task details including result if completed | P0 | |
| 21.30 | Bot cancels task | Chat with coder: "Use task_cancel to cancel task <id>" | Task cancelled | P1 | |
| 21.31 | Bot lists tasks | Chat with coder: "Use task_list to see your tasks" | Returns filtered task list | P1 | |

### Security & ACL

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.32 | ACL denied — no grant | Remove ACL: `mecha acl revoke coder analyst query`, then create task | Error: Access denied (403) | P0 | |
| 21.33 | Task ownership — read | Bot A creates task for B. Bot C tries to read it via MCP | Error: Access denied (403) — only source/target/admin can read | P0 | |
| 21.34 | Task ownership — cancel | Bot C tries to cancel Bot A's task | Error: Access denied (403) | P0 | |
| 21.35 | PATCH restricted to target bot | Direct API call: PATCH /tasks/:id with wrong x-mecha-source | Error: Only the executing bot can update task results (403) | P1 | |

### Edge Cases

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 21.36 | Path traversal in task ID | `curl -s http://127.0.0.1:<port>/tasks/..%2F..%2Fetc%2Fpasswd -H "cookie: <session>"` | Error: Invalid task ID or 404 (not file contents) | P0 | |
| 21.37 | Very long message | Create task with 10KB message | Task created and executed normally | P1 | |
| 21.38 | Bot stopped mid-task | Create task for analyst, immediately stop analyst: `mecha bot stop analyst` | Task eventually fails with error (runtime unreachable or aborted) | P1 | |
| 21.39 | Rapid create+cancel | `mecha task create analyst "hello" && mecha task cancel <id>` | Task ends up cancelled regardless of timing | P1 | |
| 21.40 | Task with wildcard host | Start mecha with `--host 0.0.0.0`, create task via CLI | CLI normalizes 0.0.0.0 to 127.0.0.1, task works | P1 | |

## Verification Queries

After each test, verify with:
```bash
mecha task list                          # All tasks
mecha task show <id>                     # Specific task detail
mecha --json task show <id>              # JSON for scripting
ls ~/.mecha/tasks/                       # Filesystem state
cat ~/.mecha/tasks/<id>.json             # Raw task JSON
cat ~/.mecha/tasks/<id>.json | jq .status  # Quick status check
```

## Test Execution Script

Quick smoke test (runs tests 21.1, 21.6, 21.12, 21.15, 21.19, 21.26):

```bash
#!/bin/bash
set -e

echo "=== 21.1: Create task ==="
ID=$(mecha --json task create analyst "What is 2+2?" | jq -r .id)
echo "Created: $ID"

echo "=== 21.6: List tasks ==="
mecha task list

echo "=== 21.12: Wait for completion ==="
for i in $(seq 1 30); do
  STATUS=$(mecha --json task show "$ID" | jq -r .status)
  echo "  Status: $STATUS"
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && break
  sleep 2
done

echo "=== 21.15: Show result ==="
mecha task show "$ID"

echo "=== 21.19: Cancel test ==="
ID2=$(mecha --json task create analyst "Write a very long essay about every country" | jq -r .id)
sleep 2
mecha task cancel "$ID2"
mecha task show "$ID2"

echo "=== 21.26: Reconciliation test ==="
ID3=$(mecha --json task create analyst "Another task" | jq -r .id)
echo "Stopping daemon..."
mecha stop
sleep 2
echo "Restarting daemon..."
mecha start -d
sleep 3
mecha task show "$ID3"  # Should show failed with "Agent restarted"

echo "=== All smoke tests done ==="
```
