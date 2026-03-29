---
description: Go coding conventions for this project
globs: "**/*.go"
---

# Go Conventions

## Project Structure

- Entry point: `cmd/mecha/main.go`
- Internal packages: `internal/` (not exported)
- One package per domain noun where possible

## Dependencies

Only these four direct dependencies:

- `github.com/spf13/cobra` — CLI
- `gopkg.in/yaml.v3` — config parsing
- `modernc.org/sqlite` — persistence (pure Go, no CGO)
- `github.com/moby/moby` — container management (Docker SDK, moby module path)

Do not add dependencies without justification.

## Patterns

- Context propagation: pass `context.Context` as first argument.
- Errors: return `error`, wrap with `fmt.Errorf("verb noun: %w", err)`.
- Graceful shutdown: signal-based context cancellation.
- Concurrency: `sync.Mutex` for shared state, not channels.
- IDs: `crypto/rand` → hex, not UUIDs.
- Atomic writes: temp file → fsync → rename → fsync dir.
- File limit: 200 lines per file (loc-guardian enforced).

## Testing

- Table-driven tests.
- `t.TempDir()` for temporary files.
- `httptest.Server` for HTTP mocking.
- No external test dependencies (use stdlib).
