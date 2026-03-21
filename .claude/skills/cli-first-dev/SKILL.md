---
name: cli-first-dev
description: "Guided CLI-first feature development. Use when implementing any new feature to enforce the CLI→Test→GUI pipeline."
---

# CLI-First Feature Development

You are guiding the user through CLI-first feature development for the mecha.im project. Every feature follows a strict pipeline: **CLI → Test → GUI**.

## Phase 1: Plan the CLI Command

1. Ask the user to describe the feature they want to build
2. Determine which existing CLI command to extend, or whether a new command is needed
3. Check `packages/cli/src/commands/` for existing patterns
4. Design the command interface: name, flags, arguments, output format
5. Present the plan for approval before writing code

### CLI Command Pattern
```typescript
// packages/cli/src/commands/{feature}.ts
import { Command } from "commander";
import type { CommandDeps } from "../types.js";

export function register{Feature}Command(program: Command, deps: CommandDeps): void {
  program
    .command("{feature}")
    .description("...")
    .option("--flag <value>", "description")
    .action(async (opts) => {
      // Implementation using deps.processManager, deps.formatter
    });
}
```

Register in `packages/cli/src/program.ts`.

## Phase 2: Implement the CLI

1. Write the command in `packages/cli/src/commands/`
2. If shared logic is needed, add it to `packages/core/` or `packages/service/`
3. Use the `CommandDeps` interface for all external dependencies (enables testing)
4. Use `deps.formatter` for all output (info, error, success, json, table)
5. Run `pnpm typecheck` to verify types

## Phase 3: Write Tests

1. Create test file at `packages/cli/__tests__/commands/{feature}.test.ts`
2. Follow existing test patterns: mock deps, create fresh Command, use `parseAsync`
3. Cover: happy path, error cases, edge cases, all flags/options
4. Run tests and verify coverage gates:
   ```bash
   cd packages/cli && pnpm vitest run --coverage
   ```
5. Coverage must meet: 95% statements/lines, 90% branches/functions

### Test Pattern
```typescript
import { Command } from "commander";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandDeps } from "../../src/types.js";
import { register{Feature}Command } from "../../src/commands/{feature}.js";

describe("{feature} command", () => {
  let program: Command;
  let deps: CommandDeps;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    deps = {
      processManager: { /* mock methods */ } as any,
      formatter: {
        info: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
        json: vi.fn(),
        table: vi.fn(),
      },
    };
    register{Feature}Command(program, deps);
  });

  it("should ...", async () => {
    await program.parseAsync(["node", "test", "{feature}"], { from: "user" });
    expect(deps.formatter.success).toHaveBeenCalledWith("...");
  });
});
```

## Phase 4: Verify All Gates

Before proceeding to GUI, ALL of these must pass:

```bash
# From repo root
pnpm test              # All tests green
pnpm test:coverage     # Coverage gates met
pnpm typecheck         # No type errors
```

**Do NOT proceed to Phase 5 until Phase 4 is fully green.**

## Phase 5: Add GUI (only after CLI + tests pass)

1. Add API route in `packages/dashboard/src/app/api/` if needed
2. Add dashboard page/component in `packages/dashboard/src/`
3. GUI must call the same shared logic from `packages/core/` or `packages/service/`
4. GUI must NOT duplicate business logic that exists in the CLI path
5. Keep GUI components thin — presentation and user interaction only

## Enforcement Summary

| Gate | Requirement | Command |
|------|-------------|---------|
| CLI exists | Feature implemented as command | Check `packages/cli/src/commands/` |
| Tests pass | All tests green | `pnpm test` |
| Coverage met | 100% thresholds | `pnpm test:coverage` |
| Types clean | No errors | `pnpm typecheck` |
| GUI allowed | Only after all above pass | Proceed to dashboard/ui |
