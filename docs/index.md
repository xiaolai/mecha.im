---
layout: home

hero:
  name: Mecha
  text: Agentic Workflow Engine
  tagline: An event-driven server that dispatches tasks to LLM workers and writes results back to GitHub.
  image:
    src: /favicon.svg
    alt: Mecha
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/xiaolai/mecha.im

features:
  - title: Event → Task → Result
    details: Events arrive, match to workers, dispatch as tasks, filter through policies, write back. One pipeline.
  - title: Any LLM Worker
    details: Claude, Codex, Gemini, Ollama, or any HTTP endpoint. Managed containers or unmanaged services — same contract.
  - title: Policy-Gated Security
    details: Workers never see GitHub tokens. All writes go through Policy first. One security boundary. One audit trail.
  - title: Single Binary
    details: Built in Go. Cross-platform. No runtime dependencies. Just download and run.
---
