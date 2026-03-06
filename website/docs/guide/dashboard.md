---
title: Dashboard
description: Using the Mecha web dashboard
---

# Dashboard

The Mecha dashboard is a single-page application (SPA) that provides a visual interface for managing your bots, sessions, schedules, and system settings.

## Accessing the Dashboard

The dashboard is served automatically when you start Mecha:

```bash
mecha start --port 7660
```

Open `http://localhost:7660` in your browser. On first visit, you'll be prompted for a TOTP code.

## Pages

| Page | Description |
|------|-------------|
| **Home** | Overview of all bots with status indicators |
| **Bot Detail** | Bot config, sessions, schedules, and logs |
| **Nodes** | Mesh node management and health monitoring |
| **Schedules** | Cross-bot schedule overview |
| **Settings** | Auth profiles, sandbox, plugins, ACL, audit log |
| **Terminal** | Web-based PTY terminal for bot interaction |

## Authentication

Dashboard auth uses TOTP (Time-based One-Time Password). Set it up via CLI:

```bash
mecha totp setup
```

Scan the QR code with an authenticator app, then verify:

```bash
mecha totp verify <code>
```

## Component Reference

For the complete list of React components, hooks, and UI primitives, see the [Dashboard Components Reference](/reference/components).
