# Integration Testing Rule

When running integration tests from `integration-tests/`, document findings **immediately** — not after a batch, not at the end.

## Before every test round

Before starting round NN, investigate gaps:

1. Read the test doc (`integration-tests/NN-*.md`) and the corresponding source code
2. Compare tests against current implementation — look for:
   - New features/options added since the test doc was written
   - Edge cases not covered (error paths, concurrency, platform differences)
   - Commands whose signatures changed (arguments, flags, defaults)
   - Cross-feature interactions not tested (e.g. tasks + ACL, workflow + bus)
3. If gaps are found, add new test rows to the doc **before** running
4. Note any added tests in the finding notes as "NEW — added before round NN"

## After every test (PASS or FAIL)

1. Mark the result in the test doc's Result column (PASS/FAIL + date + machine)
2. If FAIL: create or append to `integration-tests/finding-notes/round-NN-findings.md` with:
   - Date, machine, version
   - Exact command that failed
   - Actual output vs expected
   - Repro steps
3. If a fix is applied and re-tested, record the re-test result in the same finding note

## After every test round

Update `integration-tests/finding-notes/round-NN-findings.md` with:
- Total PASS/FAIL count
- Machine(s) tested
- Version tested
- Any known limitations or platform-specific notes

## File format

```markdown
# Round NN — <Category> Findings

**Version**: x.y.z
**Date**: YYYY-MM-DD
**Machine(s)**: mac-mini-home, linode02, ...

## Summary

X/Y tests passed.

## Failures

### Test NN.X — <test name>

- **Machine**: ...
- **Command**: `mecha ...`
- **Expected**: ...
- **Actual**: ...
- **Fix**: (link to commit or "pending")
- **Re-test**: PASS/FAIL (date)
```
