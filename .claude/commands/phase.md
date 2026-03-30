---
description: "Run a complete implementation phase — plan, build, audit, test, document, merge"
---

# Phase Workflow

Execute a full implementation phase from planning to merge. This is an autonomous workflow — use `/make-your-calls` mode throughout. Minimize confirmation prompts, use professional judgment, and keep moving through the steps without stopping to ask unless genuinely blocked.

## Input

`$ARGUMENTS` — format: `<number> <short-name>: <description>` (e.g., "5 policy: Policy noun with result filtering")

If `$ARGUMENTS` is empty or unparseable, ask the user: "What phase number, short name, and description?"

## Quality Gate (reused by Steps 6-10)

Each quality gate follows this pattern:
1. Run the tool
2. Fix ALL actionable findings (document waivers for false positives)
3. Run `make ci` — abort if tests fail
4. Commit with descriptive message

Maximum 3 fix iterations per gate. If findings persist after 3 rounds, document remaining items and proceed.

## Workflow

### Step 0: Preconditions

```bash
git fetch origin
git status            # must be clean
git checkout main
git pull origin main
```

Abort if working tree is dirty or branch already exists.

Run `/codex-toolkit:preflight` to verify Codex connectivity. Abort early if unavailable.

### Step 1: Branch

```bash
git checkout -b phase-<N>-<short-name>
```

### Step 2: Plan

1. Read project structure, domain model (`.claude/rules/domain-model.md`), and existing code.
2. Draft implementation plan covering:
   - Package structure (new files, modified files)
   - Data model (structs, persistence changes)
   - API changes (new endpoints, YAML fields)
   - Build sequence (ordered sub-phases with dependencies)
   - Test strategy
3. Display the plan to the user for review.

### Step 3: Codex Review

Send the plan to Codex:
```
/codex-toolkit:review-plan full dimensions
```
Revise the plan based on findings. Display revised plan to user.

### Step 4: Write Plan

Save the revised plan to `dev-docs/plans/phase-<N>.md` (local only, gitignored).

### Step 5: Implement

Build each sub-phase from the plan:
- Implement in order
- Run `make ci` after each sub-phase
- Commit after each sub-phase
- Do NOT proceed if tests fail

### Step 6: Grill (Quality Gate)

```
/grill:roast this branch
```
Select: Paranoid Mode (5 agents). Apply quality gate.

### Step 7: Codex Audit (Quality Gate)

```
/codex-toolkit:audit-fix --full
```
Codex audits, Claude fixes. Apply quality gate.

### Step 8: Test Coverage (Quality Gate)

```
/tdd-guardian:tdd-guardian-workflow
```
Target: maximize coverage for all testable code. Apply quality gate.

### Step 9: LOC Check (Quality Gate)

```
/loc-guardian:scan
```
Split any over-limit files using project extraction rules. Apply quality gate.

### Step 10: Documentation (Quality Gate)

```
/docs-guardian:generate
/docs-guardian:audit
```
After fixing, validate all Mermaid diagrams with `mcp__mermaider__validate_syntax`.
If docs changed, run `cd docs && npm run build` to verify VitePress builds.
Apply quality gate.

### Step 11: Final Gate

Run in sequence:
```bash
make ci                    # vet + test -race + build
/loc-guardian:scan          # verify no files over limit
```
All must pass. Abort merge if any fails.

### Step 12: Integration Test

Design and run integration tests BEFORE merge:
1. List new features that need testing
2. Design test matrix (simulated + live)
3. Deploy to nodes
4. Run tests
5. Write report to `dev-docs/integration-tests/round-NNN.md`

All tests must pass before proceeding to merge.

### Step 13: Merge

```bash
git checkout main
git merge phase-<N>-<short-name> --no-ff -m "merge phase <N>: <description>"
git branch -d phase-<N>-<short-name>
```

Bump version:
```
/bump patch
```

## Rules

- Every commit must pass `make ci`
- Fix all actionable findings. Document waivers for false positives.
- Commit after every logical step
- Follow `.claude/rules/` for Go conventions, security, domain model
- Save grill reports to `dev-docs/grills/` (gitignored)
- Plans and integration reports go to `dev-docs/` (gitignored)
- Integration tests must pass BEFORE merge to main
