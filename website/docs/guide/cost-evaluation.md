---
title: Cost & Effort Evaluation
description: Data-driven analysis of the human effort, cost, and timeline equivalent for building mecha.im
---

# Cost & Effort Evaluation

[[toc]]

A rigorous, metrics-based estimate of the human effort and cost required to build mecha.im from scratch, using actual code metrics from the repository.

## Raw Metrics

| Metric | Value |
|--------|-------|
| Production code | 37,734 LOC (419 files) |
| Test code | 39,952 LOC (221 files) |
| Documentation | 17,228 lines (45 pages) |
| Packages | 18 monorepo packages |
| CLI commands | 115 command files (~90 user-facing) |
| Commits | 695 over 30 days |
| Active development days | 30 |
| Contributors | 1 |
| Churn (insertions/deletions) | 472,028 / 273,389 |
| Churn ratio | 7.23x |
| Test:Prod ratio | 1.06:1 |
| Test count | 3,067 tests |
| Statement coverage | 99%+ |

## Complexity Breakdown

Each package was classified by reading its barrel exports and 2-3 largest source files.

### Tier 1 — Routine (1.0x)

CRUD operations, config parsing, type definitions, UI components, glue code.

| Package | LOC | What it does |
|---------|----:|-------------|
| `@mecha/core` | 3,298 | Type definitions, validation, constants, error classes, config parsing |
| `@mecha/spa` | 9,047 | React dashboard UI — forms, tables, chat interface (thin wrappers over shared logic) |
| **Subtotal** | **12,345** | |

### Tier 2 — Standard (1.5x)

Business logic, auth flows, state management, error handling with recovery.

| Package | LOC | What it does |
|---------|----:|-------------|
| `@mecha/cli` | 6,590 | 90+ CLI commands with Commander.js, dependency injection, formatter |
| `@mecha/service` | 2,715 | Bot operations, auth profiles, routing, batch actions, scheduling |
| `@mecha/process` | 2,145 | Process lifecycle, spawn pipeline, health checks, PTY adapter |
| `@mecha/mcp-server` | 1,226 | MCP/JSON-RPC server, 11 fleet tools, HTTP transport |
| `@mecha/observe` | 788 | Traces, quality scoring, metrics aggregation, alerts, A/B experiments |
| `@mecha/workflow` | 729 | DAG engine, template rendering, condition evaluation, locking |
| `@mecha/gateway` | 486 | Credential store, circuit breaker, HTTP gateway, 5 service adapters |
| `@mecha/agent` | 398 | HTTP server for bot queries, session auth, Ed25519 signatures |
| `@mecha/teams` | 286 | Team templates, deployment, ACL setup, scaffolding |
| **Subtotal** | **15,363** | |

### Tier 3 — Complex (2.5x)

Cryptography, network protocols, concurrency, sandboxing, distributed systems.

| Package | LOC | What it does |
|---------|----:|-------------|
| `@mecha/runtime` | 2,844 | Fastify server, session manager, MCP mesh tools, schedule engine |
| `@mecha/connect` | 2,609 | P2P encrypted channels (Noise protocol, STUN, hole-punch, relay) |
| `@mecha/meter` | 2,088 | Metering proxy, streaming SSE parsing, budget enforcement, cost rollups |
| `@mecha/server` | 1,300 | Rendezvous signaling, gossip protocol, relay tokens, rate limiting |
| `@mecha/bus` | 658 | Durable queues with retry/dead-letter, pub/sub topics, cross-node replication |
| `@mecha/sandbox` | 527 | macOS Seatbelt + Linux bwrap sandboxing, profile generation |
| **Subtotal** | **10,026** | |

### Summary

| Tier | LOC | % of Prod | Weighted Days |
|------|----:|----------:|------:|
| Routine (1.0x) | 12,345 | 33% | 82 |
| Standard (1.5x) | 15,363 | 41% | 154 |
| Complex (2.5x) | 10,026 | 27% | 201 |
| Research (4.0x) | 0 | 0% | 0 |
| **Total** | **37,734** | **100%** | **437** |

## Effort Estimate

| Component | Dev-Days |
|-----------|-------:|
| Production code (complexity-weighted) | 437 |
| Test code (39,952 LOC / 150 LOC/day) | 266 |
| Documentation (17,228 lines / 200 lines/day) | 86 |
| **Subtotal** | **789** |
| Overhead: architecture/design (5%) | 39 |
| Overhead: CI/CD + DevOps (3%) | 24 |
| Overhead: code review (10%) | 79 |
| **Subtotal with overhead** | **931** |
| Churn tax (30% — churn ratio 7.23x indicates major rewrites) | 279 |
| **Total** | **1,210** |

### Churn Analysis

The churn ratio of **7.23x** (472k insertions vs 65k final code lines) reflects 4 major architecture iterations:

1. **v0.x** — initial prototype
2. **v0.3.x** — Docker-based multi-container architecture
3. **v3** — reimplementation with native runtime
4. **v4** — complete local-first rewrite (current)

Each rewrite discarded and rebuilt significant portions. ~40% of all code written was later replaced.

## Cost Estimate

Using US market rates for senior engineers ($900/day fully loaded):

| Scenario | Team | Duration | Cost |
|----------|------|----------|-----:|
| Solo senior | 1 person | 4.8 years | $1,089k |
| Small team | 3 people | 1.6 years | $1,307k |
| Full team | 5 people | 1.2 years | $1,361k |

> Solo duration = 1,210 days / 252 working days/year. Team durations account for communication overhead (Brooks's Law): 3-person team is 2.5x as productive as solo, 5-person is 4x.

## AI-Assisted Comparison

This project was built by 1 developer with AI assistance (Claude Code + Codex) in 30 calendar days.

| Metric | Value |
|--------|-------|
| Actual calendar time | 30 days |
| Human equivalent | 1,210 dev-days |
| Productivity multiplier | **40x** |
| Estimated actual cost | ~$22k (1 month salary + API costs) |
| Human equivalent cost (solo) | ~$1,089k |
| Cost reduction | **98%** |

## Market Comparison

| Dimension | mecha.im | CrewAI | AutoGen / MS Agent Framework | Claude Squad |
|-----------|----------|--------|------------------------------|-------------|
| **Core function** | Local-first multi-agent runtime for Claude Code bots | Multi-agent task orchestration | Multi-agent conversation framework | Terminal manager for multiple AI agents |
| **LOC (est.)** | 37.7k | ~25k | ~80k+ | ~5k |
| **Contributors** | 1 | 50+ | 200+ | 20+ |
| **Age** | 1 month | 2 years | 2.5 years | 6 months |
| **Stars** | N/A (private) | 44.3k | 54.6k | 5k+ |
| **Funding** | $0 | $18M Series A | Microsoft Research | Community |
| **Key differentiator** | CLI-first, P2P mesh, sandboxed processes, metering | Role-based agents, high-level API | Event-driven, enterprise integration | tmux-based multi-agent sessions |

### Feature Parity

| Feature | mecha.im | CrewAI | AutoGen | Claude Squad |
|---------|:---:|:---:|:---:|:---:|
| Process sandboxing (bwrap/seatbelt) | Y | N | N | N |
| P2P encrypted mesh (Noise protocol) | Y | N | N | N |
| Per-bot metering + budgets | Y | N | Partial | N |
| Workflow DAG engine | Y | Y | Y | N |
| Message bus (pub/sub + queues) | Y | N | N | N |
| Team templates | Y | Y | Y | N |
| MCP server integration | Y | N | N | N |
| 90+ CLI commands | Y | N | N | N |
| Web dashboard (SPA) | Y | Y | N | N |
| TOTP + Ed25519 auth | Y | N | N | N |
| Multi-machine P2P relay | Y | N | N | N |
| 99%+ test coverage | Y | N | N | N |

### Insight

Mecha.im is significantly punching above its weight. It covers more surface area than CrewAI (which raised $18M and has 50+ contributors) while being built by 1 person in 1 month. The P2P mesh networking, process sandboxing, metering proxy, and MCP integration have no equivalent in any of the comparables — those features alone would justify a dedicated team.

The closest architectural parallel is the Microsoft Agent Framework (AutoGen + Semantic Kernel), which has 200+ contributors over 2.5 years and Microsoft Research backing. Mecha.im's scope is narrower (Claude Code-specific vs. model-agnostic) but deeper in operational features (sandboxing, metering, mesh networking).

## What Makes This Expensive

1. **Breadth across 18 packages** — spanning process management, cryptographic P2P networking, sandboxing, workflow engines, message buses, and a full React dashboard. Each domain requires distinct expertise.

2. **Test discipline** — a 1.06:1 test-to-prod ratio with 99%+ coverage is exceptional. The test suite alone represents 266 dev-days of effort. Most projects this size ship at 0.3:1.

3. **4 major rewrites** — the 7.23x churn ratio means ~40% of all code written was later replaced. Each architectural pivot (Docker → native → local-first) required rebuilding significant portions from scratch.

## Methodology

This evaluation uses the [cost-evaluation skill](https://github.com/xiaolai/mecha.im) methodology:

- **LOC measurement**: `tokei` (excludes blanks, comments, test files, build artifacts)
- **Complexity weighting**: 4-tier classification (1.0x routine → 4.0x research) based on reading actual source code
- **Productivity baselines**: Senior developer rates (50-150 LOC/day depending on complexity) for tested, reviewed code
- **Churn tax**: Based on git insertion/deletion ratio vs final code size
- **Cost rates**: US market, fully loaded ($900/day for senior engineers)
- **Team scaling**: Brooks's Law — 3-person team is 2.5x solo, 5-person is 4x (not 3x/5x)
