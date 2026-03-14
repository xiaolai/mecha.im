---
layout: home

hero:
  name: Mecha
  text: An Army of Bots in Docker
  tagline: Run autonomous Claude bots with scheduling, webhooks, and bot-to-bot communication — all from your terminal.
  image:
    src: /hero-mecha.png
    alt: Mecha
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quickstart
    - theme: alt
      text: Why Mecha?
      link: /guide/

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/></svg>'
    title: Docker-Native
    details: Each bot runs inside its own Docker container with process isolation, mounted workspaces, and s6-overlay for service management.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    title: Cron Scheduling
    details: Schedule bots on cron with built-in safety rails — max 50 runs/day, 10-minute timeout, auto-pause after 5 consecutive errors.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
    title: Webhooks
    details: Bots accept GitHub webhooks and react to events like pull_request.opened or push — perfect for CI/CD automation.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>'
    title: Bot-to-Bot Communication
    details: Bots discover each other over Tailscale and talk via MCP tools — mecha_call, mecha_list, mecha_new_session.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
    title: Real Claude Code
    details: Not a wrapper around a generic API. Each bot gets the full Claude Code toolset — file editing, bash, web search, MCP servers.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'
    title: CLI-First
    details: Every feature works from the terminal. Script it, pipe it, cron it. The dashboard is a convenience, not a requirement.
---
