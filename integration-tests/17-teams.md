# 17 - Team Templates

End-to-end tests for one-command team deployment and teardown.

## Prerequisites

- mecha v0.2.17+
- Workspace directory for the team (e.g., `/tmp/team-project`)

## Setup

Create a team definition:
```bash
mkdir -p /tmp/team-project
cat > /tmp/dev-team.json << 'EOF'
{
  "name": "dev-team",
  "workspace": "/tmp/team-project",
  "bots": {
    "developer": {
      "cwd": "/tmp/team-project/src",
      "tags": ["engineering"],
      "expose": ["query"]
    },
    "reviewer": {
      "cwd": "/tmp/team-project",
      "tags": ["quality"],
      "expose": ["query"]
    }
  },
  "acl": [
    { "source": "developer", "targets": ["reviewer"], "capabilities": ["query"] }
  ],
  "scaffold": {
    "/tmp/team-project/.claude/CLAUDE.md": "# Dev Team\nAll code must have tests."
  }
}
EOF
```

## Team Lifecycle

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 17.1 | Deploy team | `mecha team deploy /tmp/dev-team.json` | 2 bots spawned, ACL configured, CLAUDE.md scaffolded | P0 | |
| 17.2 | List teams | `mecha team list` | Shows dev-team with 2 bots | P0 | |
| 17.3 | Team status | `mecha team status dev-team` | Shows team name, bots, workspace, deployedAt | P0 | |
| 17.4 | Verify scaffold | `cat /tmp/team-project/.claude/CLAUDE.md` | Contains "All code must have tests" | P0 | |
| 17.5 | Verify ACL | `mecha acl show` | Shows developer → reviewer (query) | P0 | |
| 17.6 | Verify bots running | `mecha bot ls` | Shows developer and reviewer as running | P0 | |
| 17.7 | Chat with team bot | `mecha bot chat developer "say hello"` | Response from developer bot | P0 | |

## Shared HOME

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 17.8 | Deploy with shared HOME | Deploy team with `"home": "~/.mecha/_company"` | Both bots share HOME, company CLAUDE.md loaded | P1 | |
| 17.9 | Shared CLAUDE.md | Write to `~/.mecha/_company/.claude/CLAUDE.md`, chat with bot | Bot follows company instructions | P1 | |

## Teardown

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 17.10 | Teardown team | `mecha team teardown dev-team` | All bots stopped, team unregistered | P0 | |
| 17.11 | Force teardown | `mecha team teardown dev-team --force` | Bots force-killed | P0 | |
| 17.12 | Team gone after teardown | `mecha team list` | dev-team no longer listed | P0 | |

## Error Cases

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 17.13 | Invalid definition | `mecha team deploy /tmp/bad.json` (missing bots) | Error with validation message | P0 | |
| 17.14 | Scaffold path traversal | Definition with `scaffold: {"/etc/evil": "..."}` | Error: path outside allowed roots | P1 | |
| 17.15 | Deploy failure | Definition with invalid bot config | Error, no partial team left | P1 | |
