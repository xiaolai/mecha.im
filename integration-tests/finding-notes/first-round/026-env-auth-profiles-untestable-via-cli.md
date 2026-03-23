# 026 - $env: Auth Profiles Untestable via CLI

**Severity:** Medium
**Tests affected:** 6.5

## Problem

Auto-discovered auth profiles from environment variables are named with a `$env:` prefix (e.g., `$env:api-key`, `$env:oauth`). The `$` character is interpreted as a shell variable by both bash and zsh, making these profiles unreachable via CLI commands:

```
$ mecha auth test '$env:api-key' --offline
Auth profile "$env:api-key" not found
```

Despite single-quoting, the profile lookup fails. The `auth ls` command displays these profiles, but they cannot be referenced by name in any other auth subcommand.

## Expected

Either:
1. Use a naming convention without shell-special characters (e.g., `env:api-key` or `env/api-key`)
2. Accept an `--env` flag to reference env-based profiles (e.g., `mecha auth test --env api-key --offline`)

## Impact

Cannot validate env-derived credentials offline (test 6.5). The only auth profiles that exist on this test machine are env-derived, so no auth test workflow is possible.
