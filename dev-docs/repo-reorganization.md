# Repo Reorganization: mecha.im v5

## The Realization

Shannon (sha.nnon.ai) and Mecha solve different problems that compose perfectly.

| Concern | Shannon | Mecha |
|---|---|---|
| **What** | Task execution service | Bot configuration layer |
| **Where** | Server (Docker containers) | Local (direct CLI) |
| **Trigger** | GitHub Actions → API | User → CLI |
| **Isolation** | Full (rootless Docker, no secrets in container) | None (user's own machine) |
| **Language** | Go | TypeScript |
| **Trust model** | Container is untrusted | User is trusted |
| **Orchestration** | GitHub Actions | GitHub Actions |

Shannon runs Claude workloads in Docker containers on a server. Mecha runs Claude workloads directly on your laptop. Same orchestrator (GitHub Actions). Same config format. Different execution environments.

## Proposed Structure

One repo. Two products. Shared config format.

```
mecha.im/
├── mecha/                     ← the CLI compose layer (~300 lines TS)
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
├── shannon/                   ← the execution service (Go)
│   ├── cmd/shannon/
│   ├── internal/
│   │   ├── config/
│   │   ├── contract/
│   │   ├── executor/
│   │   ├── github/
│   │   ├── logging/
│   │   ├── policy/
│   │   ├── scheduler/
│   │   ├── server/
│   │   ├── store/
│   │   └── workspace/
│   ├── go.mod
│   └── go.sum
│
├── action/                    ← GitHub Action (calls Shannon API)
│   └── action.yml
│
├── worker/                    ← Docker worker image
│   └── Dockerfile
│
├── proxy/                     ← Model proxy sidecar
│
├── website/                   ← landing page
│
├── dev-docs/                  ← architecture, plans, research
│
├── mecha.yml                  ← example config (shared format)
├── profiles.yml               ← execution profiles
├── policies.yml               ← action policies
└── README.md
```

## Why One Repo

1. **Shared config format** — `mecha.yml` defines bots. Shannon reads the same format for profile/task config.
2. **Shared action** — `xiaolai/mecha-action@v1` works whether Shannon is running or not.
3. **Shared docs** — one README: "run locally with `mecha run`, run in CI with Shannon."
4. **One product** — Mecha is the brand. Shannon is the engine.

## How They Compose

### Local development (mecha only)

```bash
mecha run reviewer "review this PR"
# → reads mecha.yml → calls query() → Claude runs on your machine
```

### CI/CD (Shannon via GitHub Actions)

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: xiaolai/mecha-action@v1
        with:
          shannon_url: ${{ secrets.SHANNON_URL }}
          prompt: "Review this PR for security issues"
          profile: heavy
```

### Self-hosted runner (mecha as fallback)

```yaml
jobs:
  review:
    runs-on: self-hosted
    steps:
      - run: mecha run reviewer "review PR #${{ github.event.number }}"
```

## The Shared Config: mecha.yml

```yaml
bots:
  reviewer:
    model: claude-sonnet-4-6
    cwd: .
    settingSources: [project]
    allowedTools: [Read, Grep, Glob]
    profile: light                          # Shannon profile (ignored by mecha CLI)
    env:
      ANTHROPIC_API_KEY: ${WORK_KEY}

# Shannon-specific (ignored by mecha CLI)
profiles:
  light:
    image: ghcr.io/xiaolai/shannon-worker@sha256:...
    resources: { cpu: 1, memory: 2G }
    timeout: 5m
  heavy:
    image: ghcr.io/xiaolai/shannon-worker@sha256:...
    resources: { cpu: 4, memory: 8G }
    timeout: 30m
```

## Migration Path

1. Tag v4 history (`v4-archive` tag) — done
2. Start fresh on orphan branch — done
3. Move Shannon from sha.nnon.ai into mecha.im/shannon/
4. Build mecha CLI in mecha.im/mecha/
5. Rename GitHub Action to xiaolai/mecha-action
6. Update website
7. Archive sha.nnon.ai (redirect to mecha.im)

## The Brand Story

**Mecha** — run Claude bots anywhere.

- `mecha run` — on your laptop, right now
- `mecha-action` — in GitHub Actions, via Shannon
- `mecha.yml` — one config, both environments

Shannon is an implementation detail. Users see "Mecha" everywhere.
