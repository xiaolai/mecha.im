---
name: release
description: Bump version, commit, tag, and push a release. Use when user says "release", "cut a release", "tag a release", or "ship it".
allowed-tools: Read, Edit, Bash(git:*), Glob, Grep
---

# Release

Bump version across all monorepo packages, commit, tag, and push.

## Usage

```
/release              → prompt for bump type
/release patch        → 0.2.0 → 0.2.1, commit, tag, push
/release minor        → 0.2.0 → 0.3.0, commit, tag, push
/release major        → 0.2.0 → 1.0.0, commit, tag, push
/release 0.3.0        → set exact version, commit, tag, push
```

## Workflow

1. **Preflight checks**:
   - Working tree must be clean (`git status --porcelain` is empty). If dirty, stop and tell the user to commit or stash first.
   - Must be on `main` branch. If not, warn but proceed if user confirms.

2. **Read current version** from root `package.json`

3. **Determine new version**:
   - If argument is `patch`, `minor`, or `major` — increment accordingly
   - If argument is a semver string (e.g. `0.3.0`) — use it directly
   - If no argument — show current version and ask which bump type

4. **Update all package.json files**:
   - Root `package.json`
   - Every `packages/*/package.json`
   - Only update the `"version"` field, nothing else

5. **Show diff summary**: `git diff --stat` + old → new version

6. **Ask for confirmation** before committing: "Release v{version}? This will commit, tag, and push."

7. **Commit**:
   ```
   git add package.json packages/*/package.json
   git commit -m "release: v{version}"
   ```

8. **Tag**:
   ```
   git tag -a v{version} -m "v{version}"
   ```

9. **Push**:
   ```
   git push origin main --follow-tags
   ```

10. **Report**: show the tag URL and summary

11. **Post-push (automated by CI)**:
    - GitHub Actions (`.github/workflows/release.yml`) triggers on the `v*` tag push
    - Builds binaries for all platforms (linux-x64, linux-arm64, darwin-arm64, darwin-x64)
    - Apple codesigns and notarizes macOS binaries
    - Creates GitHub Release with tarballs
    - Updates the Homebrew tap (`xiaolai/homebrew-tap`) with new version and SHA256 hashes
    - **Do NOT build binaries locally for releases** — CI handles this
    - Optionally verify: `gh run list --workflow release.yml --limit 1`

12. **Local upgrade** (if requested):
    - `brew update && brew upgrade mecha` to get the codesigned binary
    - Restart daemon: `mecha start --host 0.0.0.0 --daemon`

## Rules

- All packages stay in lockstep (same version)
- Never force push
- Never skip git hooks
- Tag format is `v{version}` (e.g. `v0.3.0`)
- Commit message format is `release: v{version}`
- If any step fails, stop immediately and report — do not continue
