---
description: "Run a complete implementation phase — plan, build, audit, test, document, merge"
---

# Phase Workflow

Execute a full implementation phase from planning to merge. This is the canonical workflow for adding a new feature or noun to mecha.

## Input

`$ARGUMENTS` — description of what this phase implements (e.g., "Phase 5: Policy noun")

If `$ARGUMENTS` is empty, use AskUserQuestion to ask: "What should this phase implement? Describe the feature in plain language."

## Workflow

### Step 1: Branch

```
git checkout -b phase-<N>-<short-name>
```

Parse the phase number and short name from `$ARGUMENTS`.

### Step 2: Plan

1. Read the project structure, domain model (`.claude/rules/domain-model.md`), and existing code to understand context.
2. Draft a thorough implementation plan covering:
   - Package structure (new files, modified files)
   - Data model (structs, SQLite schema)
   - API changes (new endpoints, YAML fields)
   - Build sequence (ordered steps with dependencies)
   - Test strategy
3. Display the plan to the user.

### Step 3: Codex Review

Send the plan to Codex for critical review:

```
/codex-toolkit:review-plan full dimensions
```

Wait for Codex to return findings. Revise the plan based on critical advice.

### Step 4: Write Plan

Save the revised plan to `dev-docs/plans/phase-<N>.md`.

### Step 5: Implement

Build the plan step by step:
- Implement each sub-phase in order
- Run `make ci` after each sub-phase
- Commit after each sub-phase with a descriptive message
- Do NOT proceed to the next sub-phase if tests fail

### Step 6: Grill

Run a full codebase grill on the branch:

```
/grill:roast this branch
```

Select: **Select All** (all 5 review styles + all pressure tests).

Fix ALL findings. Run `make ci`. Commit:
```
fix all N grill findings
```

### Step 7: Codex Audit

Run a full audit-fix cycle:

```
/codex-toolkit:audit-fix --full
```

Codex audits. Claude fixes. Fix ALL findings. Run `make ci`. Commit:
```
fix all N Codex audit findings
```

### Step 8: Test Coverage

Boost test coverage to maximum:

```
/tdd-guardian:tdd-guardian-workflow
```

Push coverage as high as possible for all testable code. Commit:
```
boost test coverage — package X% → Y%
```

### Step 9: LOC Check

Run LOC guardian to ensure all source files are under the limit:

```
/loc-guardian:scan
```

If any files are over limit, split them using the project's extraction rules. Commit:
```
split N over-limit files — all under 200 LOC
```

### Step 10: Documentation

Generate missing doc comments:

```
/docs-guardian:generate
```

Then run a full doc audit:

```
/docs-guardian:audit
```

Fix ALL doc findings (stale claims, missing pages, inaccurate descriptions). Commit:
```
fix all N doc findings
```

### Step 11: Final Check

Run the full CI suite:

```
make ci
```

Verify:
- `go vet` passes
- All tests pass with `-race`
- Binary builds
- No files over 200 LOC

### Step 12: Merge

```
git checkout main
git merge phase-<N>-<short-name> --no-ff -m "merge phase <N>: <description>"
git branch -d phase-<N>-<short-name>
```

Bump version:

```
/bump patch
```

### Step 13: Integration Test

Design the next round of integration tests based on what changed:

1. List all new features that need testing
2. Design test matrix (simulated + live tests)
3. Deploy to nodes
4. Run tests
5. Write report to `dev-docs/integration-tests/round-NNN.md`

## Rules

- Every commit must pass `make ci`
- No half measures — fix ALL findings, not just critical
- Commit after every logical step (not at the end)
- Follow `.claude/rules/` for Go conventions, security, domain model
- Save grill reports to `dev-docs/grills/`
- Use `make-your-calls` mode — minimize confirmation prompts, use professional judgment
