---
description: Worker result contract — the one data structure that flows through the pipeline
globs: "**/*.go"
---

# Result Contract

> Implemented in Go (`internal/policies/result.go`) and TypeScript (`docker/runtime/types.ts`).

Every worker returns the same structure. Every field optional.

```json
{
  "output": "text output from the worker",
  "comment": { "target": "pr:42", "body": "..." },
  "labels": { "add": ["security"], "remove": ["needs-review"] },
  "status": { "state": "failure", "description": "..." },
  "commit": { "message": "...", "diff": "..." },
  "metadata": {
    "model": "claude-sonnet-4-6",
    "input_tokens": 5000,
    "output_tokens": 2000,
    "duration_ms": 45000,
    "exit_code": 0
  }
}
```

## Write-Back

Write-back is routed through the Responder registry, keyed by target platform:

- `source.Responder` interface: `Name() string`, `Respond(ctx, ev, result) error`
- GitHub writeback.Client implements Responder (registered automatically)
- Dispatch tries Responder registry first, falls back to legacy writeback
- Responder is looked up by `ev.Source` (e.g., GitHub events use the GitHub responder)

## Task Retry

Transport errors (connection refused, timeout, DNS failure) trigger automatic retry
with exponential backoff (30s, 60s, 120s). Tasks that exceed `max_retries` (default: 3)
are dead-lettered (permanently failed). Non-transport errors (4xx, invalid response)
fail immediately without retry.

## Rules

- Result and side effects are one thing. No separate "action" phase.
- Policy filters the result before write-back. Denied fields are dropped.
- A completed task means its result has already been written back.
- The worker decides what to return. Policy decides what gets through.
- Responder is looked up by `ev.Source`. Target override is planned but not yet implemented.
- Failed tasks with retry attempts remaining are re-queued with exponential backoff.
- Status state validated by policy (error/failure/pending/success only).
- Comment truncation includes suffix in max_length (total never exceeds limit).
- Label matching is case-insensitive. Blocklist takes precedence over allowlist.
- Commit diffs exceeding max_size are rejected entirely (not truncated).
- Metadata can be redacted via `metadata: {allow: false}`.
