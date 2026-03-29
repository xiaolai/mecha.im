# Mecha

Mecha turns GitHub events into LLM tasks.

## Domain Model

Four nouns: Event, Worker, Task, Policy. One pipeline. See `.claude/rules/domain-model.md`.

## Tech Stack

- Go 1.26.1 — single binary, cross-platform (darwin/linux, amd64/arm64)
- Cobra CLI, YAML config, SQLite persistence, Docker API
- Hugo + Hextra for documentation (`docs/`)

## Build

```
make build    # → ./mecha binary
make test     # go test ./...
make ci       # vet + test + build
```

## Architecture Docs

Design decisions and rationale are in `dev-docs/` (gitignored, local only).
