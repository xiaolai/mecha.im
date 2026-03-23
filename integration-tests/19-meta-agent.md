# 19 - Meta-Agent

End-to-end tests for the CEO bot commands.

## Prerequisites

- mecha v0.2.17+
- A bot named `meta-agent` spawned with broad ACL grants
- At least one completed workflow run (for report/tune)

## Setup

```bash
# Spawn meta-agent bot
mecha bot spawn meta-agent /tmp/meta-workspace --sandbox off

# Give it broad ACL access
mecha acl grant meta-agent query '*'
```

## Meta Commands

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 19.1 | Goal (no bot) | Stop meta-agent, then `mecha meta goal "build a landing page"` | Error: meta-agent not running | P0 | |
| 19.2 | Goal (bot running) | Start meta-agent, `mecha meta goal "list 3 trending AI topics"` | Meta-agent responds with plan | P0 | |
| 19.3 | Status (no bot) | `mecha meta status` when meta-agent is stopped | Shows "not running" | P0 | |
| 19.4 | Status (running) | `mecha meta status` when meta-agent is running | Shows port, workflow counts | P0 | |
| 19.5 | Report (no data) | `mecha meta report` with no workflow runs | Shows "no activity" | P0 | |
| 19.6 | Report (with data) | `mecha meta report --days 7` after workflow runs | Shows summary with costs | P0 | |

## Tuning

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 19.7 | Tune (no scores) | `mecha meta tune researcher` with no quality scores | Shows "no data" | P0 | |
| 19.8 | Tune (with scores) | Rate several runs, then `mecha meta tune` | Shows trend analysis for each bot | P1 | |

## Experiment

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 19.9 | Create experiment | `mecha meta experiment test-ab --config-a a.json --config-b b.json --workflow test-pipeline --runs 3` | Experiment definition saved | P1 | |
| 19.10 | Experiment file | `cat ~/.mecha/observe/experiments/test-ab.json` | Valid JSON with variants and workflow | P1 | |

## Cross-Node Awareness

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 19.11 | Status with nodes | Register nodes, then `mecha meta status` | Shows remote node status (online/offline + latency) | P0 | |
| 19.12 | Status no nodes | `mecha meta status` with no registered nodes | No remote section shown | P0 | |
