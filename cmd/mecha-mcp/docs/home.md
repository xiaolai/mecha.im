---
layout: home

hero:
  name: Mecha
  text: AI on your PRs. Your infra. Your rules.
  tagline: Turn GitHub events into LLM tasks — one binary, YAML config, policy-controlled write-back.
  image:
    src: /mecha-512.png
    alt: Mecha
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/xiaolai/mecha.im

features:
  - icon: "🔀"
    title: Run Claude, Codex, or Gemini on every PR
    details: GitHub or GitLab webhook arrives, mecha matches it to a worker, dispatches the prompt, writes the result back. Automatic.
  - icon: "🔧"
    title: Switch models in one line
    details: Docker workers for Claude/Codex/Gemini. Adapters for Ollama, vLLM, or any OpenAI-compatible API. Same contract, swap the YAML.
  - icon: "🛡️"
    title: Control what AI can write back
    details: Policy decides per-worker — allow comments, block labels, limit length, deny commits. One YAML block. One security boundary.
  - icon: "📦"
    title: Self-hosted single binary
    details: Built in Go. No cloud dependency. No runtime. Your code stays on your infra. Works on macOS and Linux.
---

<style>
.how-it-works {
  max-width: 768px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}
.how-it-works h2 {
  text-align: center;
  font-size: 1.5rem;
  margin-bottom: 2rem;
}
.how-it-works .language-yaml,
.how-it-works .language-bash {
  font-size: 0.85rem;
}
</style>

<div class="how-it-works">

## Define a worker. Start it. Done.

```yaml
name: pr-reviewer
docker:
  image: mecha-worker-claude:latest
  token: claude.default
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
events:
  - source: github
    on: [pull_request.opened]
    prompt: "Review this PR for security issues.\n\n{{.diff}}"
policy:
  comment: { allow: true }
  status: { allow: true }
  commit: { allow: false }
```

```bash
mecha worker add workers/pr-reviewer.yml
mecha serve
```

Every PR now gets an automated review — comments, status checks, labels — controlled by policy.

## The pipeline

```
Event.arrive → Event.match → Task.create → Task.dispatch → Policy.filter → Task.complete
```

Four nouns: **Event**, **Worker**, **Task**, **Policy**. The pipeline is deterministic. The LLM is the only smart part. Policy is the only gate.

</div>
