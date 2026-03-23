# 09 - Dashboard & SPA

Tests for the web dashboard UI and agent API consumed by the SPA.

## Prerequisites

- Mecha daemon running with dashboard: `mecha start -d --host 0.0.0.0`
- Browser access to dashboard (default port 7660)

## Tests

### Dashboard Access

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 9.1 | Dashboard login | Navigate to `http://<ip>:7660`, enter TOTP code | Redirected to dashboard home | P0 | |
| 9.2 | Invalid TOTP | Enter wrong code | Login rejected | P0 | |
| 9.3 | Session persistence | Login, close tab, reopen | Still authenticated (cookie valid) | P1 | |

### Bot Management UI

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 9.4 | Bot list page | Navigate to dashboard home | Shows all bots with status indicators | P0 | |
| 9.5 | Bot detail page | Click on a bot | Shows status, config, actions (start/stop/restart) | P0 | |
| 9.6 | Spawn bot via UI | Click "New Bot", fill form, submit | Bot spawns, appears in list | P1 | |
| 9.7 | Stop bot via UI | Click stop on running bot | Bot stops, status updates | P1 | |
| 9.8 | View logs | Navigate to bot logs page | Shows stdout/stderr output | P1 | |

### Terminal

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 9.9 | WebSocket terminal | Open terminal for running bot | Interactive Claude session via xterm.js | P1 | |
| 9.10 | Terminal reconnect | Disconnect network briefly, reconnect | Terminal resumes or shows reconnect prompt | P2 | |

### Node & Mesh UI

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 9.11 | Nodes page | Navigate to /nodes | Shows registered + discovered nodes | P1 | |
| 9.12 | Remote bot view | Click on remote node's bot | Shows status from remote agent | P1 | |

### Settings

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 9.13 | Settings page | Navigate to /settings | Shows node config, auth profiles, TOTP | P2 | |
| 9.14 | Mobile responsive | Open dashboard on phone-width browser | Layout adapts, no horizontal scroll | P2 | |

## Cross-Browser Matrix

| Test | Chrome | Firefox | Safari |
|------|--------|---------|--------|
| Login | | | |
| Bot list | | | |
| Terminal | | | |
| Responsive | | | |
