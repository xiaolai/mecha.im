# Shannon Media Crew — Design Spec

**Date**: 2026-03-24
**Domain**: sha.nnon.app
**Status**: Draft

A Mecha bot crew that researches, writes, reviews, and publishes a Claude-focused media site. The site covers developer tools (Claude Code, Agent SDK, MCP), broad ecosystem content (prompting, API, business use cases), and news aggregation. Content is published daily, with news cycling every 6 hours.

---

## 1. Crew Overview

**Team name**: `shannon`
**Shared workspace**: `~/mecha-bots-projects/shannon`
**Shared home**: `~/.mecha/teams/shannon/home`
**Publishing model**: Human-directed (editor sets topics, bots execute, human approves PRs)
**Site framework**: Astro + MDX (bots scaffold and maintain the site)
**Scale**: Single machine initially, designed for multi-node expansion

### The 7 Bots

| Bot | Model | Tags | Role | Effort |
|---|---|---|---|---|
| `editor` | `claude-opus-4-6` | `editorial, orchestrator` | Editorial director. Receives briefs from human, decomposes into assignments, orchestrates pipeline, final editorial review. | high |
| `scout` | `claude-sonnet-4-6` | `news, monitoring` | News monitor. Scans Anthropic blog, GitHub releases, X, HN, Reddit every 6h. Outputs structured briefs with significance ratings. | medium |
| `researcher` | `claude-opus-4-6` | `research, analysis` | Deep research. Gathers sources, code examples, verifies claims. Produces structured research briefs with citations. | high |
| `writer` | `claude-opus-4-6` | `writing, content` | Technical writer. Drafts MDX content. Clear, practical, opinionated voice. Tested code examples, not toy snippets. | high |
| `reviewer` | `claude-sonnet-4-6` | `review, qa` | Quality gate. Fact-checks, validates code, checks MDX, enforces style. Produces PASS/FAIL reports with fix instructions. | high |
| `architect` | `claude-opus-4-6` | `infrastructure, astro` | Site builder. Scaffolds and maintains the Astro site -- components, layouts, schemas, config. Does not write content. | high |
| `publisher` | `claude-sonnet-4-6` | `git, deploy` | Git/deploy pipeline. Commits to branches, creates PRs with structured descriptions, validates schema pre-commit. Never pushes to main. | medium |

All bots share `cwd: ~/mecha-bots-projects/shannon`.

---

## 2. ACL & Communication

### Communication Flow

```
                    HUMAN (you)
                      |
                      v
                   editor <---------- scout (pushes news briefs)
                   |    |
          +--------+    +--------+
          v        v    v        v
     researcher  writer reviewer  architect
                   |        |         |
                   +---+----+         |
                       v              |
                   publisher <--------+
                       |
                       v
                   Git PR -> You approve
```

### Bot Expose Configuration

Each bot must declare which capabilities it accepts inbound:

| Bot | Expose |
|---|---|
| `editor` | `query, read_workspace` |
| `scout` | `query` |
| `researcher` | `query, read_workspace` |
| `writer` | `query, read_workspace, write_workspace` |
| `reviewer` | `query, read_workspace` |
| `architect` | `query, read_workspace, write_workspace` |
| `publisher` | `query, read_workspace` |

### ACL Rules

| Source | Targets | Capabilities |
|---|---|---|
| `editor` | `*` (all bots) | `query, read_workspace` |
| `scout` | `editor` | `query` |
| `researcher` | `editor` | `query` |
| `writer` | `editor` | `query` |
| `writer` | `researcher` | `read_workspace` |
| `reviewer` | `editor, writer` | `query` |
| `reviewer` | `writer, researcher` | `read_workspace` |
| `architect` | `publisher` | `query` |
| `publisher` | `editor` | `query` |
| `publisher` | `writer, reviewer, architect` | `read_workspace` |

### Data Flow Between Bots

Data passes between bots via two mechanisms:

1. **Workflow template rendering** (primary): The workflow engine pipes step outputs between steps via `{{step.output}}` templates. This is the main data handoff mechanism -- no bus topics needed within workflows.
2. **Direct query** (`mecha_query` MCP tool): For ad-hoc communication outside workflows (e.g., editor asks scout for a status update).

**Bus topics are NOT used for workflow data flow.** The workflow engine handles all inter-step data piping. Bus topics are reserved for future async notification use cases (e.g., scout dropping unsolicited briefs outside the cron cycle).

---

## 3. Workflows

### Scheduling

Mecha's built-in **workflow scheduler** reads `trigger.schedule` from workflow YAML definitions and auto-triggers execution. Supports both cron expressions and interval strings.

Workflow definitions include their schedule in the `trigger` field:
```yaml
trigger:
  schedule: "0 */6 * * *"   # cron: every 6 hours
```

The scheduler auto-pauses after 5 consecutive errors and supports pause/resume via API.

### 3.1 `news-cycle` (cron: every 6 hours)

```
scout (scan sources, output briefs)
  -> editor (triage, select significance >= 3)
  -> writer (draft MDX news articles)
  -> reviewer (quick review: accuracy, URLs, MDX validity)
  -> publisher (create PR per article, label "news")
```

- Timeout: 10m per step
- Review mode: quick (accuracy + URLs + MDX only)
- Reviewer output: `{ passed: true/false, checks: [...], fix_instructions: [] }`
- If reviewer fails content, the workflow ends and editor is notified -- no automatic retry for news (fast SLA, human decides whether to re-run)

### 3.2 `editorial-piece` (manual trigger)

```
editor (decompose brief into spec)
  -> researcher (gather sources, verify claims, save research brief)
  -> writer (draft MDX from spec + research)
  -> reviewer (full review: all 6 checks)
  -> writer (revise if FAIL, conditional step, max 2 retries)
  -> editor (final editorial review, human gate)
  -> publisher (create PR, label by category)
```

- Timeout: 15m for research step, 10m for all others
- Review mode: full (factual accuracy, code correctness, freshness, MDX, style, completeness)
- Reviewer output: `{ passed: true/false, checks: [...], fix_instructions: [] }`
- Conditional revision: `condition: "!review.passed"` -- triggers only on FAIL
- **Max 2 revision rounds**: if the second revision still fails review, the workflow escalates to editor with the failure report instead of looping indefinitely
- Human gate before publish

### 3.3 `site-maintenance` (cron: weekly Monday 9am + manual)

```
architect (audit: broken links, stale content, schema issues, build health)
  -> architect (fix infrastructure issues, flag stale content for editor)
  -> editor (weekly health report, stale content list)
  -> publisher (create PR for fixes, label "maintenance")
```

---

## 4. Content Architecture

### Site Structure

```
shannon/                              (~/mecha-bots-projects/shannon)
├── astro.config.mjs
├── package.json
├── src/
│   ├── content/
│   │   ├── config.ts                 <- Zod content collection schemas
│   │   ├── news/                     <- published news (status: "published")
│   │   ├── tutorials/
│   │   ├── tips/
│   │   ├── deep-dives/
│   │   ├── comparisons/
│   │   └── changelog/
│   ├── pages/
│   │   ├── index.astro
│   │   ├── {category}/[...slug].astro
│   │   ├── about.astro
│   │   └── rss.xml.ts
│   ├── layouts/
│   │   ├── Base.astro
│   │   ├── Article.astro
│   │   └── List.astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── ArticleCard.astro
│   │   ├── CodeBlock.astro
│   │   ├── AgentBadge.astro          <- shows producing agents
│   │   ├── SourcesList.astro
│   │   ├── NewsletterSignup.astro
│   │   └── SearchBar.astro           <- pagefind
│   └── styles/
│       └── globals.css
├── public/
│   ├── favicon.svg
│   └── og/
└── .github/
    └── workflows/
        └── deploy.yml
```

Research briefs and WIP drafts are stored as workflow step outputs (in `~/.mecha/workflows/runs/`), not in the content directory. Only finished MDX files land in `src/content/{category}/`.

### MDX Frontmatter Schema

```typescript
{
  title: string,
  description: string,
  publishedAt: date,
  updatedAt?: date,
  category: "news" | "tutorial" | "tip" | "deep-dive" | "comparison" | "changelog",
  tags: string[],
  difficulty?: "beginner" | "intermediate" | "advanced",
  sources: { title: string, url: string }[],
  agents: string[],               // which bots produced this
  estimatedReadTime?: number,
}
```

### Content Cadence

| Category | Cadence | Length | Pipeline |
|---|---|---|---|
| `news` | 4x/day (every 6h) | 300-800 words | `news-cycle` |
| `changelog` | per release | 500-1500 words | `editorial-piece` (triggered by scout) |
| `tips` | daily | 200-500 words | `editorial-piece` (lightweight) |
| `tutorials` | 2-3x/week | 1000-3000 words | `editorial-piece` (full) |
| `deep-dives` | 1x/week | 2000-5000 words | `editorial-piece` (full, high effort) |
| `comparisons` | 1-2x/month | 1500-3000 words | `editorial-piece` (full) |

### Transparency

Every article displays an `AgentBadge` showing which bots were involved:
> Produced by Shannon: scout -> writer -> reviewer -> publisher

---

## 5. Deployment & Operations

### Bootstrap Sequence

```bash
# 1. Deploy the team (YAML supported, workflows and schedules auto-provisioned)
mecha team deploy shannon-team.yaml

# 2. Architect scaffolds the Astro site
mecha query architect "Scaffold a new Astro 5 site with MDX, Tailwind, Pagefind,
content collections (news, tutorials, tips, deep-dives, comparisons, changelog),
RSS feed, dark/light mode, and GitHub Actions deploy workflow.
Domain: sha.nnon.app."

# 4. Verify build
mecha query architect "Run astro check and astro build. Fix any issues."

# 5. Publisher sets up git
mecha query publisher "Initialize git remote. Create main branch protection:
require PR reviews, no direct push to main."

# 6. Workflow scheduler auto-starts with the runtime
# news-cycle runs every 6h, site-maintenance weekly (from trigger.schedule in YAML)
```

### Daily Operations

```bash
# Check overnight news
mecha query editor "Show me today's news briefs from scout. What's worth covering?"

# Direct content
mecha query editor "New assignment: tutorial on X. Target: intermediate. Length: 2000 words."

# Monitor
mecha team status shannon
mecha workflow runs news-cycle
mecha workflow runs editorial-piece
```

### Multi-Node Expansion (Future)

Add `node: beefy-server` to heavy bots (researcher, writer) in the team definition. Lightweight bots stay local.

Workspace syncs via `mecha team sync shannon` (rsync over SSH). Supports `--node` for single-node sync and `--dry-run` for preview.

---

## 6. Team Definition File

The team definition supports both JSON and YAML. Save as `shannon-team.yaml`:

```json
{
  "name": "shannon",
  "home": "~/.mecha/teams/shannon/home",
  "workspace": "~/mecha-bots-projects/shannon",
  "bots": {
    "editor": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-opus-4-6",
      "tags": ["editorial", "orchestrator"],
      "expose": ["query", "read_workspace"],
      "effort": "high",
      "sandboxMode": "auto",
      "systemPrompt": "You are the editorial director of Shannon (sha.nnon.app), an independent Claude-focused media site.\n\nYour responsibilities:\n- Receive topic briefs from the human editor\n- Decompose briefs into assignments for researcher, writer, reviewer\n- Triage news briefs from scout (significance >= 3 gets coverage)\n- Final editorial review before content goes to publisher\n- Maintain editorial calendar and content standards\n- Track what's been covered to avoid duplication\n\nContent categories: news, tutorials, tips, deep-dives, comparisons, changelog.\nVoice: clear, practical, opinionated. Not corporate-bland. Not AI-slop.\n\nYou orchestrate. You don't write content yourself."
    },
    "scout": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-sonnet-4-6",
      "tags": ["news", "monitoring"],
      "expose": ["query"],
      "effort": "medium",
      "sandboxMode": "auto",
      "systemPrompt": "You are the news scout for Shannon (sha.nnon.app).\n\nMonitor these sources for Claude/Anthropic developments:\n- Anthropic blog (anthropic.com/news, /research)\n- GitHub releases: anthropics/claude-code, anthropics/claude-agent-sdk, anthropics/courses\n- X/Twitter: @AnthropicAI, @alexalbert__, @amanrsanger, key devrel accounts\n- Hacker News: Claude-related posts\n- Reddit: r/ClaudeAI, r/LocalLLaMA (Claude mentions)\n- Claude Code changelog\n\nEvery scan, output a JSON array of briefs:\n[{title, source_url, significance (1-5), summary, category}]\n\nSignificance guide:\n5 = major release, new model, pricing change\n4 = notable feature, API change, important blog post\n3 = interesting community development, useful tip discovered\n2 = minor update, routine maintenance\n1 = noise, already well-known\n\nOnly report genuinely new items. Never fabricate sources."
    },
    "researcher": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-opus-4-6",
      "tags": ["research", "analysis"],
      "expose": ["query", "read_workspace"],
      "effort": "high",
      "sandboxMode": "auto",
      "systemPrompt": "You are the deep research specialist for Shannon (sha.nnon.app).\n\nGiven a topic assignment from the editor:\n1. Gather comprehensive sources: official docs, code examples, community discussions, benchmarks\n2. Verify claims against primary sources -- never trust secondary summaries alone\n3. For code topics: find real, working examples. Test API calls against current docs.\n4. For comparison topics: use identical test cases across subjects\n5. Produce structured research briefs with full citations\n\nOutput format: {sources: [{title, url, relevance}], key_findings: [], code_examples: [], open_questions: []}\n\nIf you cannot find reliable information on something, say so explicitly.\nNever fabricate sources, URLs, or data."
    },
    "writer": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-opus-4-6",
      "tags": ["writing", "content"],
      "expose": ["query", "read_workspace", "write_workspace"],
      "effort": "high",
      "sandboxMode": "auto",
      "systemPrompt": "You are the technical writer for Shannon (sha.nnon.app), a Claude developer media site.\n\nVoice & style:\n- Clear, practical, opinionated -- not corporate-bland\n- Lead with the actionable insight, not background\n- Code examples must be real and tested, not toy snippets\n- Every article has a clear thesis and teaches something specific\n- Never pad content. If a tip is 200 words, it's 200 words.\n- Use \"you\" not \"we\" or \"one\"\n\nFormat: MDX with Astro-compatible frontmatter. Required fields:\ntitle, description, publishedAt, category, tags, sources, agents\n\nTemplates by category:\n- news: lede -> what happened -> why it matters -> what to do\n- tutorial: what you'll build -> prerequisites -> steps -> result\n- tip: the tip -> why it works -> example -> gotchas\n- deep-dive: thesis -> context -> analysis -> implications\n- comparison: criteria -> side-by-side -> verdict\n- changelog: what changed -> migration notes -> examples\n\nSave MDX files to the appropriate src/content/ subdirectory."
    },
    "reviewer": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-sonnet-4-6",
      "tags": ["review", "qa"],
      "expose": ["query", "read_workspace"],
      "effort": "high",
      "sandboxMode": "auto",
      "systemPrompt": "You are the quality gate for Shannon (sha.nnon.app).\n\nReview checklist:\n1. FACTUAL ACCURACY: Do claims match cited sources? Are URLs real and accessible?\n2. CODE CORRECTNESS: Do code examples work? Are API calls current? Run them.\n3. FRESHNESS: Are referenced versions/features current, not deprecated?\n4. MDX VALIDITY: Does frontmatter match schema? Is MDX parseable?\n5. STYLE: Does it match Shannon's voice? No AI slop (filler phrases, hedge words, corporate tone)?\n6. COMPLETENESS: Does the article deliver on its title/description promise?\n\nOutput format:\n{\n  \"passed\": true|false,\n  \"checks\": [{\"name\": \"...\", \"passed\": true|false, \"details\": \"...\"}],\n  \"fix_instructions\": []\n}\n\nTwo review modes:\n- Quick (news): checks 1, 2, 3, 4 only. Fast SLA.\n- Full (tutorials, deep-dives): all 6 checks. Thorough.\n\nBe specific. \"Needs improvement\" is not useful. \"Line 47: claims Claude 4 supports X but docs say this was added in 4.5\" is useful."
    },
    "architect": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-opus-4-6",
      "tags": ["infrastructure", "astro"],
      "expose": ["query", "read_workspace", "write_workspace"],
      "effort": "high",
      "sandboxMode": "auto",
      "systemPrompt": "You build and maintain the Astro site for Shannon (sha.nnon.app).\n\nTech stack:\n- Astro 5+ with MDX integration\n- Content Collections with Zod schemas\n- Tailwind CSS for styling\n- Pagefind for client-side search\n- RSS feed generation\n- OG image generation\n\nPrinciples:\n- Zero unnecessary JavaScript. Use Astro components, not React, unless interactivity is required.\n- Content Collections are the single source of truth for content schema.\n- Mobile-first responsive design.\n- Dark/light mode via CSS custom properties.\n- Fast: target Lighthouse 100/100 on all metrics.\n- Accessible: semantic HTML, proper heading hierarchy, alt text.\n\nYou do NOT write content. You build the platform content lives on.\nWhen the content schema needs updating (new category, new frontmatter field), you update config.ts."
    },
    "publisher": {
      "cwd": "~/mecha-bots-projects/shannon",
      "model": "claude-sonnet-4-6",
      "tags": ["git", "deploy"],
      "expose": ["query", "read_workspace"],
      "effort": "medium",
      "sandboxMode": "auto",
      "systemPrompt": "You handle the git and deployment pipeline for Shannon (sha.nnon.app).\n\nGit workflow:\n1. Create feature branch from main: {category}/{YYYY-MM-DD}-{slug}\n2. Commit MDX file(s) with clear commit message\n3. Create PR with structured description:\n   - Content type and category\n   - Sources referenced\n   - Word count\n   - Which agents were involved\n   - Review summary (PASS/FAIL details)\n4. Label PR by category: \"news\", \"tutorial\", \"tip\", \"deep-dive\", \"comparison\", \"changelog\", \"maintenance\"\n\nRules:\n- NEVER push directly to main\n- NEVER force push\n- Validate MDX files pass schema before committing (astro check)\n- One PR per content piece (not batched)\n- Report PR URL back to editor"
    }
  },
  "acl": [
    { "source": "editor", "targets": ["scout", "researcher", "writer", "reviewer", "architect", "publisher"], "capabilities": ["query", "read_workspace"] },
    { "source": "scout", "targets": ["editor"], "capabilities": ["query"] },
    { "source": "researcher", "targets": ["editor"], "capabilities": ["query"] },
    { "source": "writer", "targets": ["editor"], "capabilities": ["query"] },
    { "source": "writer", "targets": ["researcher"], "capabilities": ["read_workspace"] },
    { "source": "reviewer", "targets": ["editor", "writer"], "capabilities": ["query"] },
    { "source": "reviewer", "targets": ["writer", "researcher"], "capabilities": ["read_workspace"] },
    { "source": "architect", "targets": ["publisher"], "capabilities": ["query"] },
    { "source": "publisher", "targets": ["editor"], "capabilities": ["query"] },
    { "source": "publisher", "targets": ["writer", "reviewer", "architect"], "capabilities": ["read_workspace"] }
  ],
  "scaffold": {
    "dirs": [
      ".claude",
      "src/content/news",
      "src/content/tutorials",
      "src/content/tips",
      "src/content/deep-dives",
      "src/content/comparisons",
      "src/content/changelog",
      "src/pages",
      "src/layouts",
      "src/components",
      "src/styles",
      "public/og",
      ".github/workflows"
    ]
  }
}
```

---

## 7. Cost Estimate

| Activity | Frequency | Est. Cost |
|---|---|---|
| Scout scans | 4x/day | ~$0.50/day |
| News articles | 2-4x/day | ~$2-4/day |
| Tutorials | 2-3x/week | ~$3-5 each |
| Deep-dives | 1x/week | ~$5-10 each |
| Tips | daily | ~$0.50 each |
| Site maintenance | weekly | ~$2-3/run |
| **Monthly total** | | **~$150-300** |

No budget limits initially. Measure actual costs, then optimize.

---

## 8. Research Context

### Competitive Landscape

The Claude content ecosystem is fragmented. No authoritative independent hub exists. Content is scattered across GitHub repos (claude-code-tips, claude-code-ultimate-guide), small blogs (ClaudeAI.dev, ClaudeLog), and Anthropic's own Academy.

### Differentiation

Shannon's unique angles:
1. **Dogfooding** -- powered by Mecha bots, demonstrating the product while producing content about it
2. **Always-current** -- 6-hour news cycle catches developments same-day
3. **Tested content** -- every code snippet verified by reviewer bot before publication
4. **Transparent pipeline** -- AgentBadge shows which bots produced each article
5. **Independent voice** -- opinionated, practical, not vendor-controlled

### Technical Choices

- **Astro + MDX**: zero JS default, fastest content site performance, type-safe content collections (2026 consensus for content-heavy sites)
- **Git-based workflow**: agents commit to branches, humans review PRs, merge triggers deploy
- **Multi-agent pipeline**: Research -> Write -> Review -> Publish with structured handoffs (proven pattern across CrewAI, LangGraph implementations)

---

## 9. Known Limitations & Future Work

| Item | Status | Workaround |
|---|---|---|
| Workflow cron scheduling | Not implemented | System crontab calls `mecha workflow run` |
| `team deploy` YAML support | JSON only | Use JSON team definition |
| `team sync` for multi-node | Not implemented | Shared filesystem or manual rsync |
| Bus subscribe MCP tool | Not implemented | Workflows use template piping; bus not needed for workflow data flow |
| Workflow conditional expressions | Limited to truthy/falsy dot-paths | Use `"!review.passed"` format; reviewer outputs `{ passed: bool }` |
| Workflow step timeout enforcement | Passed through but not enforced by engine | Monitor manually; add engine-level enforcement later |
