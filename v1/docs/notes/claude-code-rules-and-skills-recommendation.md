# Claude Code Rules and Skills Recommendation

## 1. Goal

Define what rules and skills Claude Code should use to implement Mecha plans with high confidence, strict quality gates, and strong test rigor.

This note is discussion/design only.

## 2. Core Principles

1. Plan-first execution: no coding before mapping work to explicit Work Items and acceptance criteria.
2. Scope discipline: implement only approved MVP scope.
3. Test quality over test quantity: coverage metrics are necessary but not sufficient.
4. Regression prevention: every bug fix must include a failing test first.
5. Verifiable completion: each Work Item must pass tests, coverage gates, and review gates.

## 3. Recommended `.claude/rules/*/*` Layout

```text
.claude/rules/
  00-governance/
    01-plan-first.md
    02-scope-control.md
  10-execution/
    01-small-batches.md
    02-definition-of-done.md
  20-testing/
    01-test-design-matrix.md
    02-coverage-gate.md
    03-mutation-gate.md
  30-quality/
    01-no-fake-tests.md
    02-regression-proof.md
  40-review/
    01-findings-first.md
  90-safety/
    01-command-safety.md
```

## 4. Rule Intent (What Each Rule Should Enforce)

### `00-governance/01-plan-first.md`
1. Must reference a plan file before implementation.
2. Must map edits to specific Work Item IDs.
3. Must restate acceptance criteria before coding.

### `00-governance/02-scope-control.md`
1. No out-of-scope features unless explicitly approved.
2. Deferred ideas go to notes, not implementation.
3. Minimize change surface to requested scope.

### `10-execution/01-small-batches.md`
1. Implement one Work Item at a time.
2. Run targeted tests after each batch.
3. Stop and report blockers immediately.

### `10-execution/02-definition-of-done.md`
1. Code complete.
2. Tests added/updated.
3. Quality gates passed.
4. Risks and assumptions documented.

### `20-testing/01-test-design-matrix.md`
For each changed behavior, require tests for:
1. Success path.
2. Boundary values.
3. Guard clauses (invalid input / preconditions).
4. Error/failure paths.
5. State transitions and idempotency where applicable.
6. Timeouts/retries/concurrency when applicable.

### `20-testing/02-coverage-gate.md`
1. Enforce `100%` for `lines`, `functions`, `branches`, `statements` on changed modules.
2. Include all source files in coverage collection (`all files` mode).
3. Fail if any changed module drops below threshold.

### `20-testing/03-mutation-gate.md`
1. Run mutation tests on changed modules.
2. Fail below mutation score threshold (suggestion: start at `85%`, ratchet upward).
3. For surviving mutants, add stronger assertions or better test design.

### `30-quality/01-no-fake-tests.md`
1. No assertion-free tests.
2. No snapshot-only logic validation.
3. No excessive mocking of the unit under test.

### `30-quality/02-regression-proof.md`
1. For each bug fix: write a failing reproducer test first.
2. Then implement fix.
3. Keep reproducer test permanently.

### `40-review/01-findings-first.md`
1. Review outputs list findings first, sorted by severity.
2. Include file and line references.
3. Include missing-test findings explicitly.

### `90-safety/01-command-safety.md`
1. Avoid destructive commands without explicit approval.
2. Do not revert unrelated local changes.
3. Prefer deterministic, non-interactive tooling.

## 5. Skills/Subagents Claude Code Should Have

1. `planner`
   - Produces Work Items with acceptance criteria and test targets.
2. `implementer`
   - Applies minimal code changes for one Work Item.
3. `test-designer`
   - Produces test matrix and concrete edge-case set.
4. `coverage-auditor`
   - Reports coverage gaps by file and branch.
5. `mutation-auditor`
   - Reports surviving mutants and required assertion upgrades.
6. `reviewer`
   - Produces severity-ordered findings with evidence.

## 6. Workflow Commands (Suggested)

1. `/plan-implement`
   - planner -> implementer -> test-designer.
2. `/coverage-audit`
   - coverage-auditor.
3. `/mutation-audit`
   - mutation-auditor.
4. `/final-review`
   - reviewer, findings-first output.

## 7. How to Approach “100% Coverage” Correctly

1. Gate on all four metrics: lines/functions/branches/statements.
2. Require branch-focused tests, not only line execution.
3. Use mutation testing to detect weak assertions.
4. Apply immediate strictness to changed code.
5. Use ratcheting policy for untouched legacy code until full repo reaches 100%.
6. Treat coverage exceptions as explicit, reviewed, and temporary.

## 8. CI Gate Recommendation

Merge should fail if any of these fail:
1. Unit/integration tests.
2. Coverage thresholds for changed modules.
3. Mutation threshold for changed modules.
4. Lint/type checks.
5. Plan acceptance criteria verification.

## 9. Source References

1. Claude Code settings:
   - https://docs.claude.com/en/docs/claude-code/settings
2. Claude Code hooks:
   - https://docs.claude.com/en/docs/claude-code/hooks
3. Claude Code memory/import:
   - https://docs.claude.com/en/docs/claude-code/memory
4. Claude Code slash commands:
   - https://docs.claude.com/en/docs/claude-code/slash-commands
5. Claude Code subagents:
   - https://docs.claude.com/en/docs/claude-code/sub-agents
6. Vitest coverage configuration:
   - https://vitest.dev/config/
7. Stryker mutation thresholds:
   - https://stryker-mutator.io/docs/stryker-js/configuration/

