---
description: "Create a GitHub release from the latest version tag"
---

Create a GitHub release from the latest version tag.

Steps:
1. Get the latest semver tag: `git tag -l 'v*' --sort=-version:refname | head -1` → TAG
2. Verify HEAD is on that tag: `git describe --tags --exact-match HEAD`
3. If HEAD is not tagged, abort and suggest running `/bump` first
4. Get the previous tag: `git tag -l 'v*' --sort=-version:refname | sed -n '2p'` → PREV_TAG
5. Generate changelog: `git log PREV_TAG..TAG --oneline`
6. Build the binary for the current platform: `make build`
7. Create the GitHub release: `gh release create TAG --title "TAG" --notes "CHANGELOG" ./mecha`
8. Print the release URL
