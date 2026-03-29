Create a GitHub release from the latest version tag.

Steps:
1. Get the latest semver git tag: `git describe --tags --abbrev=0 --match 'v*'`
2. Verify HEAD is on that tag: `git describe --tags --exact-match HEAD`
3. If HEAD is not tagged, abort and suggest running `/bump` first
4. Generate changelog from commits since the previous tag: `git log PREV_TAG..TAG --oneline`
5. Build the binary for the current platform: `make build`
6. Create the GitHub release: `gh release create TAG --title "TAG" --notes "CHANGELOG" ./mecha`
7. Print the release URL
