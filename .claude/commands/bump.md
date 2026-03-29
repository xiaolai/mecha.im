---
description: "Bump the project semver tag (patch, minor, or major)"
---

Bump the project version. Argument: $ARGUMENTS (one of: patch, minor, major — default: patch).

Steps:
1. List all semver tags sorted by version: `git tag -l 'v*' --sort=-version:refname | head -1`
2. If no tag exists, start from v0.0.0
3. Parse the tag as semver (vMAJOR.MINOR.PATCH)
4. Increment the requested component (patch by default), resetting lower components to 0
5. Update the version in any relevant files if needed
6. Create an annotated git tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
7. Print: `vOLD → vNEW`
