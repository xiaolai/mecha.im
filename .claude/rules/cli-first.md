---
description: Enforces CLI-first development pattern for all new features
globs: "**/*.{ts,tsx}"
---

# CLI-First Development Rule

Every new feature MUST follow this development order:

## 1. CLI First (packages/cli/)
- Implement the feature as a CLI command or extend an existing one
- Follow the existing pattern: export a `register*Command(program, deps)` function
- Use the `CommandDeps` interface for dependency injection (processManager, formatter)
- The CLI layer proves the feature works end-to-end before any GUI exists

## 2. Tests Before GUI
- Write comprehensive tests in `packages/cli/__tests__/`
- Tests must pass the package coverage gates (100% statements, branches, functions, lines)
- Run `pnpm test` and `pnpm test:coverage` to verify
- NO GUI work begins until CLI tests are green and coverage gates pass

## 3. GUI Last (packages/dashboard/, packages/ui/)
- Only after CLI + tests are complete, add GUI components
- GUI should call the same underlying logic (via packages/core/, packages/service/, packages/runtime/)
- GUI must NOT implement business logic that doesn't exist in the CLI path

## Checklist (enforce on every feature)
- [ ] CLI command implemented and working
- [ ] Unit tests written and passing
- [ ] Coverage gates met
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Only THEN: GUI components added
