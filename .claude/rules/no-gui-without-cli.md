---
description: Blocks GUI-only features - requires CLI implementation first
globs: "packages/{dashboard,ui}/src/**/*.{ts,tsx}"
---

# No GUI Without CLI

STOP. Before writing any new feature code in dashboard/ or ui/:

1. Does a corresponding CLI command exist in `packages/cli/src/commands/`?
2. Do tests exist in `packages/cli/__tests__/` for this feature?
3. Do those tests pass with coverage gates met?

If ANY answer is NO → implement the CLI version first.

## What this means in practice

- New API routes in `packages/dashboard/src/app/api/` must have a CLI equivalent
- New dashboard pages that perform actions must map to CLI commands
- Shared business logic belongs in `packages/core/` or `packages/service/`, not in GUI components
- GUI components are thin wrappers that present data and call shared logic

## Exceptions
- Pure UI concerns (styling, layout, responsive design) don't need CLI equivalents
- Dashboard-only read views that aggregate existing CLI data are acceptable
- Component library work (shadcn, assistant-ui primitives) is exempt
