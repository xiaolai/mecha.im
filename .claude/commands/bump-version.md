Bump the version number across all package.json files, commit, tag, push, and publish to npmjs.

## Arguments

`$ARGUMENTS` is the bump type: `patch` (default), `minor`, or `major`.

## Instructions

1. Parse `$ARGUMENTS` — if empty, default to `patch`. Valid values: `patch`, `minor`, `major`.

2. Read the current version from `package.json` (root).

3. Compute the new version by bumping the appropriate segment (semver):
   - `patch`: 0.3.0 → 0.3.1
   - `minor`: 0.3.0 → 0.4.0
   - `major`: 0.3.0 → 1.0.0

4. Update `"version"` in all package.json files that share the same version:
   - `package.json` (root)
   - `agent/dashboard/package.json`

5. Show the user what changed: `Old: X.Y.Z → New: A.B.C`

6. Commit: `git add package.json agent/dashboard/package.json && git commit -m "chore: bump version to A.B.C"`

7. Tag: `git tag vA.B.C`

8. Push: `git push && git push --tags`

9. Build: `npm run build`

10. Publish: `npm publish --access public`

11. Confirm: "Published `@mecha.im/cli@A.B.C` to npmjs."
