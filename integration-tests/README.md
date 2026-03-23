# Mecha Integration Testing Matrix

Comprehensive integration testing plan for mecha.im.

## Test Machines

| Machine | Tailscale IP | OS | Arch | Install |
|---------|-------------|-----|------|---------|
| linode02 | 100.100.1.9 | Linux | x64 | `sudo npm install -g` |
| spark01 | 100.100.1.5 | Linux | arm64 | `sudo npm install -g` |
| mac-mini-home | 100.100.1.7 | macOS | arm64 | `npm install -g` |
| jokershp-wsl | 100.100.1.4 | Linux (WSL2 on Windows) | x64 | `npm install -g` inside WSL |

## Test Categories

### Core Features (rounds 1-13)

| # | Category | File | Tests | Priority |
|---|----------|------|-------|----------|
| 1 | [Bot Lifecycle](./01-bot-lifecycle.md) | 01-bot-lifecycle.md | 22 | P0 |
| 2 | [Chat & Query](./02-chat-query.md) | 02-chat-query.md | 16 | P0 |
| 3 | [Sessions](./03-sessions.md) | 03-sessions.md | 12 | P1 |
| 4 | [Scheduling](./04-scheduling.md) | 04-scheduling.md | 18 | P1 |
| 5 | [Mesh Networking](./05-mesh-networking.md) | 05-mesh-networking.md | 20 | P0 |
| 6 | [Auth & Security](./06-auth-security.md) | 06-auth-security.md | 22 | P0 |
| 7 | [Metering & Budgets](./07-metering-budgets.md) | 07-metering-budgets.md | 14 | P1 |
| 8 | [MCP Server](./08-mcp-server.md) | 08-mcp-server.md | 16 | P1 |
| 9 | [Dashboard & SPA](./09-dashboard-spa.md) | 09-dashboard-spa.md | 14 | P2 |
| 10 | [Sandbox](./10-sandbox.md) | 10-sandbox.md | 10 | P1 |
| 11 | [Failure & Recovery](./11-failure-recovery.md) | 11-failure-recovery.md | 16 | P0 |
| 12 | [Multi-Machine](./12-multi-machine.md) | 12-multi-machine.md | 18 | P0 |
| 13 | [Upgrade & Migration](./13-upgrade-migration.md) | 13-upgrade-migration.md | 8 | P2 |

### Orchestration Layers (rounds 14-20)

| # | Category | File | Tests | Priority |
|---|----------|------|-------|----------|
| 14 | [Message Bus](./14-message-bus.md) | 14-message-bus.md | 15 | P0 |
| 15 | [Workflow Engine](./15-workflow-engine.md) | 15-workflow-engine.md | 13 | P0 |
| 16 | [Observability](./16-observability.md) | 16-observability.md | 14 | P0 |
| 17 | [Teams](./17-teams.md) | 17-teams.md | 15 | P0 |
| 18 | [Gateway & Secrets](./18-gateway-secrets.md) | 18-gateway-secrets.md | 10 | P1 |
| 19 | [Meta-Agent](./19-meta-agent.md) | 19-meta-agent.md | 12 | P1 |
| 20 | [Cross-Node Orchestration](./20-cross-node-orchestration.md) | 20-cross-node-orchestration.md | 18 | P1 |
| 21 | [Task Protocol](./21-task-protocol.md) | 21-task-protocol.md | 40 | P0 |
| **Total** | | | **343** | |

## Priority Levels

- **P0** - Must pass before any release. Blocks deployment.
- **P1** - Should pass. Degraded functionality if broken.
- **P2** - Nice to have. Cosmetic or edge-case coverage.

## How to Run

Each file contains step-by-step test procedures with exact commands.
Mark each test PASS/FAIL with the date and machine tested.

### Recommended order for new orchestration tests:
1. Round 14 (bus) — foundational, no dependencies
2. Round 15 (workflow) — requires bots from round 1-2
3. Round 16 (observability) — requires completed workflow runs from round 15
4. Round 17 (teams) — requires round 1-2, standalone otherwise
5. Round 18 (secrets) — standalone
6. Round 19 (meta-agent) — requires rounds 15-16 for meaningful data
7. Round 20 (cross-node) — requires round 12 mesh setup + all above

## Prerequisites

```bash
# All machines
mecha --version           # Confirm installed
mecha init                # Initialize node
mecha start -d --host 0.0.0.0   # Start daemon

# Environment
cat ~/.mecha/.env         # Confirm ANTHROPIC_API_KEY set
```
