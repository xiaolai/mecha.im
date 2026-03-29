---
description: Worker result contract — the one data structure that flows through the pipeline
globs: "**/*.go"
---

# Result Contract

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
    "duration_ms": 45000
  }
}
```

## Rules

- Result and side effects are one thing. No separate "action" phase.
- Policy filters the result before write-back. Denied fields are dropped.
- A completed task means its result has already been written back.
- The worker decides what to return. Policy decides what gets through.
