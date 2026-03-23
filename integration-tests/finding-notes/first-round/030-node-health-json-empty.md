# 030 - node health --json Produces No Output

**Severity:** Low
**Tests affected:** 5.10

## Problem

`mecha node health [name] --json` returns exit code 0 but produces no JSON output:

```
$ mecha node health linode02 --json
(no output)

$ mecha node health --json
(no output)
```

The human-readable output works correctly:

```
$ mecha node health linode02
linode02: 545ms - (http)
```

## Expected

JSON output should return structured health data:

```json
[{"name": "linode02", "healthy": true, "latencyMs": 545, "type": "http"}]
```

## Impact

Tooling and scripts that consume `--json` output for health monitoring get empty results.
